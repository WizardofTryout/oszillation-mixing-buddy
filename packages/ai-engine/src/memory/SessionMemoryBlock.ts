/**
 * SessionMemoryBlock.ts – Bündelt Journal, Dialog-Gedächtnis und Drift-Warnungen
 * zum Prompt-Block `=== SESSION MEMORY & ACTION JOURNAL ===`.
 */

import { actionJournal } from './ActionJournal.js';
import { dialogueMemory } from './DialogueMemory.js';
import { DawDriftGuard, type ChannelStripSummary } from './DawDriftGuard.js';

export const SESSION_MEMORY_HEADER = '=== SESSION MEMORY & ACTION JOURNAL ===';
export const SESSION_MEMORY_FOOTER = '=== END SESSION MEMORY ===';

/**
 * Baut den Memory-Block. Liefert einen leeren String, solange weder Journal,
 * Dialog-Gedächtnis noch Drift-Warnungen vorhanden sind (keine Scheindaten).
 */
export function buildSessionMemoryBlock(currentStrips: ChannelStripSummary[]): string {
  const journalSummary = actionJournal.toCompactPromptSummary();
  const dialogueContext = dialogueMemory.toPromptContext().trim();
  const drift = DawDriftGuard.checkDrift(actionJournal.getAllEntries(), currentStrips);

  if (!journalSummary && !dialogueContext && !drift.hasDrift) {
    return '';
  }

  const parts: string[] = [SESSION_MEMORY_HEADER];
  if (journalSummary) parts.push(journalSummary);
  if (dialogueContext) parts.push(dialogueContext);
  if (drift.hasDrift) parts.push(drift.summaryText.trim());
  parts.push(
    'Hinweis: Auf Zuruf wie "mach das wie am Anfang" nutze das Tool restore_previous_action mit den Original-Werten aus dem Journal.'
  );
  parts.push(SESSION_MEMORY_FOOTER);

  return '\n' + parts.join('\n') + '\n';
}
