export interface PrivacyChoice {
  notice_version: number;
  consent_version: number;
  accepted: boolean;
}
export interface Operator {
  kind: string;
  legal_name: string;
  inn: string;
  registration: string;
  address: string;
  contact: string;
  contractors: string;
  locations: string;
  staff_basis: string;
  approved: boolean;
}
export interface PrivacyDocument {
  id: number;
  template_version: string;
  operator: Operator;
  policy: string;
  consent: string;
  published_at: string;
}
