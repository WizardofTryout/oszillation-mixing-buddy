/**
 * License & Entitlement Gatekeeper Schemas (https://buddy.oszillation-studio.de/api/v1)
 */

export type LicenseTier = 'trial' | 'pro_subscription' | 'studio_perpetual';

export interface LicenseStatus {
  isValid: boolean;
  tier: LicenseTier;
  licensee: string;
  expiresAtEpochMs: number;
  lastOnlineCheckEpochMs: number;
  offlineGraceDaysRemaining: number;
  features: {
    maxTracks: number;
    allowMcpServer: boolean;
    allowLocalModels: boolean;
    allowCloudReasoning: boolean;
  };
}

export interface LicenseVerificationPayload {
  machineFingerprint: string;
  licenseKey: string;
  osVersion: string;
  clientVersion: string;
}
