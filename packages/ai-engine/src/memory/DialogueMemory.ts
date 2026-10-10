/**
 * DialogueMemory.ts – Rolling Dialogue Memory & Condensation Engine
 * Oszillation Mixing Buddy (Universal AI Co-Producer)
 *
 * Implements a strict sliding window (last 3 dialog turns) and
 * deterministic condensation for older turns (> 3).
 *
 * Token Diet Guarantee:
 * The exported prompt summary strictly occupies <= 350 tokens
 * under any conversation length (even 20+ turns).
 */

import type { DialogueTurn, RollingDialogueState } from './types.js';

export class DialogueMemoryManager {
  private recentTurns: DialogueTurn[] = [];
  private condensedHistorySummary: string = '';
  private turnCounter: number = 0;

  private readonly maxRecentTurns: number = 3;
  // 1.300 characters is conservatively ~300-325 tokens in English/German (average 4 chars/token)
  private readonly maxPromptChars: number = 1300;

  constructor() {
    this.reset();
  }

  /**
   * Resets the dialogue memory.
   */
  public reset(): void {
    this.recentTurns = [];
    this.condensedHistorySummary = '';
    this.turnCounter = 0;
  }

  /**
   * Extracts a single concise sentence from AI text (max 130 chars).
   */
  public static extractSingleSentence(text: string): string {
    if (!text || text.trim().length === 0) return 'Keine Anmerkung.';
    // Clean markdown bold/italic and redundant spaces
    const cleaned = text
      .replace(/[*_#`]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Match first sentence ending
    const match = cleaned.match(/^([^.!?\n]+[.!?]?)/);
    const firstSentence = match ? match[1].trim() : cleaned;
    if (firstSentence.length > 130) {
      return firstSentence.slice(0, 127).trim() + '...';
    }
    return firstSentence;
  }

  /**
   * Truncates a user prompt to a compact single-line string (max 140 chars).
   */
  public static cleanUserPrompt(prompt: string): string {
    const cleaned = prompt.replace(/\s+/g, ' ').trim();
    if (cleaned.length > 140) {
      return cleaned.slice(0, 137).trim() + '...';
    }
    return cleaned;
  }

  /**
   * Adds a completed dialog turn. Older turns beyond 3 are deterministically condensed.
   */
  public addTurn(
    userPrompt: string,
    aiSummary: string,
    options?: {
      monitoringTrack?: string;
      appliedActionIds?: string[];
      timestamp?: number;
    }
  ): void {
    this.turnCounter++;
    const turnIndex = this.turnCounter;
    const cleanUser = DialogueMemoryManager.cleanUserPrompt(userPrompt);
    const cleanAi = DialogueMemoryManager.extractSingleSentence(aiSummary);

    const turn: DialogueTurn = {
      turnIndex,
      timestamp: options?.timestamp ?? Date.now(),
      userPrompt: cleanUser,
      aiSummary: cleanAi,
      monitoringTrack: options?.monitoringTrack,
      appliedActionIds: options?.appliedActionIds
    };

    if (this.recentTurns.length >= this.maxRecentTurns) {
      const evicted = this.recentTurns.shift();
      if (evicted) {
        this.condenseEvictedTurn(evicted);
      }
    }

    this.recentTurns.push(turn);
  }

  /**
   * Deterministically updates condensedHistorySummary when a turn is evicted from the sliding window.
   */
  private condenseEvictedTurn(turn: DialogueTurn): void {
    // Extract instrument or action keywords
    const snippet = `T${turn.turnIndex}: "${turn.userPrompt}" → ${turn.aiSummary}`;
    if (!this.condensedHistorySummary) {
      this.condensedHistorySummary = `Frühere Themen: ${snippet}`;
    } else {
      // Append and ensure it does not exceed 2 sentences or ~240 characters
      const combined = `${this.condensedHistorySummary}; ${snippet}`;
      if (combined.length > 240) {
        // Keep previous essence and latest condensed turn
        const parts = combined.split('; ');
        const kept = parts.length > 2 ? [parts[0], parts[parts.length - 1]].join('; ') : combined;
        this.condensedHistorySummary = kept.slice(0, 237) + '...';
      } else {
        this.condensedHistorySummary = combined;
      }
    }
  }

  /**
   * Populates/syncs the dialogue memory from a raw message history (e.g. from ChatConsole).
   */
  public syncFromMessages(
    messages: Array<{ sender: 'user' | 'assistant'; text: string }>,
    activeMonitoringTrack?: string
  ): void {
    if (!messages || messages.length === 0) {
      return;
    }

    this.reset();

    // Group alternating user / assistant messages into turns
    let currentUserMsg: string | null = null;
    for (const msg of messages) {
      if (msg.sender === 'user') {
        if (currentUserMsg !== null) {
          // User sent consecutive messages without assistant reply
          this.addTurn(currentUserMsg, 'Vom Engineer präzisiert.', {
            monitoringTrack: activeMonitoringTrack
          });
        }
        currentUserMsg = msg.text;
      } else if (msg.sender === 'assistant' && currentUserMsg !== null) {
        this.addTurn(currentUserMsg, msg.text, {
          monitoringTrack: activeMonitoringTrack
        });
        currentUserMsg = null;
      }
    }

    // If there is a trailing pending user message without assistant reply yet
    if (currentUserMsg !== null) {
      this.addTurn(currentUserMsg, '(In Bearbeitung)', {
        monitoringTrack: activeMonitoringTrack
      });
    }
  }

  /**
   * Returns a copy of the sliding window (max 3 turns).
   */
  public getRecentTurns(): DialogueTurn[] {
    return [...this.recentTurns];
  }

  /**
   * Returns the condensed history summary for all turns older than the sliding window.
   */
  public getCondensedSummary(): string {
    return this.condensedHistorySummary;
  }

  /**
   * Builds the token-constrained prompt block for LLM system instructions.
   * STRICT TOKEN DIET GUARANTEE: Never exceeds 350 tokens (capped at maxPromptChars).
   */
  public toPromptContext(): string {
    if (this.recentTurns.length === 0 && !this.condensedHistorySummary) {
      return '';
    }

    const lines: string[] = ['COMPACT WORKING MEMORY (Recent Dialog Context):'];

    if (this.condensedHistorySummary.trim().length > 0) {
      lines.push(`Earlier History: ${this.condensedHistorySummary.trim()}`);
    }

    for (const turn of this.recentTurns) {
      const trackHint = turn.monitoringTrack ? ` [Track: ${turn.monitoringTrack}]` : '';
      lines.push(
        `- Turn ${turn.turnIndex}${trackHint}: Engineer: "${turn.userPrompt}" → Co-Producer: "${turn.aiSummary}"`
      );
    }

    let result = lines.join('\n') + '\n\n';

    // Hard safety clamp to strictly uphold the <= 350 tokens constraint
    if (result.length > this.maxPromptChars) {
      result = result.slice(0, this.maxPromptChars - 15) + '...\n\n';
    }

    return result;
  }

  /**
   * Serializes current dialogue memory for session file persistence (*.omb-session.json).
   */
  public serialize(): RollingDialogueState {
    return {
      recentTurns: this.getRecentTurns(),
      condensedHistorySummary: this.condensedHistorySummary
    };
  }

  /**
   * Deserializes previously saved dialogue memory.
   */
  public deserialize(state: RollingDialogueState): void {
    if (!state) return;
    this.recentTurns = Array.isArray(state.recentTurns) ? [...state.recentTurns] : [];
    this.condensedHistorySummary = state.condensedHistorySummary || '';
    const maxIdx = this.recentTurns.reduce((max, t) => Math.max(max, t.turnIndex || 0), 0);
    this.turnCounter = maxIdx;
  }
}

/** Global singleton instance */
export const dialogueMemory = new DialogueMemoryManager();
