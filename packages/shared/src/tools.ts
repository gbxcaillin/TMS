/**
 * Registry of the skill-backed advice tools. The web app renders run forms
 * from these definitions and the worker uses them to build the agent prompt.
 *
 * `skill` must match the `name` in the SKILL.md you drop into
 * agent/skills/<skill>/SKILL.md.
 */

export type ToolId =
  | 'fee-comparison'
  | 'product-comparison'
  | 'tax-optimisation'
  | 'annual-review'
  | 'soa-roa';

export type ToolField =
  | { kind: 'client'; key: 'clientId'; label: string; required: boolean }
  | { kind: 'files'; key: string; label: string; accept: string; required: boolean; help?: string }
  | { kind: 'select'; key: string; label: string; options: { value: string; label: string }[]; required: boolean }
  | { kind: 'text'; key: string; label: string; placeholder?: string; required: boolean }
  | { kind: 'textarea'; key: string; label: string; placeholder?: string; required: boolean }
  | { kind: 'date'; key: string; label: string; required: boolean };

export interface ToolDefinition {
  id: ToolId;
  name: string;
  short: string;
  description: string;
  skill: string;
  /** Portal context the worker writes into the run folder before the agent starts. */
  context: Array<'client' | 'holdings' | 'emails' | 'meetings' | 'notes' | 'tasks'>;
  /** Documents produced by this tool are compliance documents and need adviser sign-off. */
  requiresApproval: boolean;
  fields: ToolField[];
  expectedOutputs: string[];
}

const REPORT_ACCEPT = '.pdf,.csv,.xlsx,.xls,.docx';

export const TOOLS: ToolDefinition[] = [
  {
    id: 'fee-comparison',
    name: 'Fee Comparison',
    short: 'Compare total cost across platforms and products',
    description:
      'Compares administration, investment, adviser and transaction fees for a client’s current position against one or more alternatives, in dollars and percentages.',
    skill: 'fee-comparison',
    context: ['client', 'holdings'],
    requiresApproval: false,
    fields: [
      { kind: 'client', key: 'clientId', label: 'Client', required: false },
      { kind: 'files', key: 'statements', label: 'Current platform statements / fee disclosures', accept: REPORT_ACCEPT, required: false },
      { kind: 'text', key: 'alternatives', label: 'Alternatives to compare', placeholder: 'e.g. HUB24 Choice, Netwealth Accelerator Core', required: true },
      { kind: 'text', key: 'balance', label: 'Balance to model (if no client selected)', placeholder: '$750,000', required: false },
    ],
    expectedOutputs: ['Fee comparison table (.xlsx)', 'Summary for file (.docx)'],
  },
  {
    id: 'product-comparison',
    name: 'Product Feature Comparison',
    short: 'Side-by-side features of products and platforms',
    description:
      'Builds a feature comparison of platforms or products (menu, insurance, reporting, estate features, access) against the client’s needs.',
    skill: 'product-comparison',
    context: ['client'],
    requiresApproval: false,
    fields: [
      { kind: 'client', key: 'clientId', label: 'Client', required: false },
      { kind: 'text', key: 'products', label: 'Products to compare', placeholder: 'e.g. CFS Edge, Macquarie Wrap, Praemium', required: true },
      { kind: 'textarea', key: 'needs', label: 'Client needs / must-haves', required: false },
      { kind: 'files', key: 'pds', label: 'PDS / product guides', accept: '.pdf,.docx', required: false },
    ],
    expectedOutputs: ['Feature comparison (.xlsx)', 'Comparison summary (.docx)'],
  },
  {
    id: 'tax-optimisation',
    name: 'Tax Minimisation & Loss Harvesting',
    short: 'Identify CGT offsets and harvesting opportunities',
    description:
      'Analyses unrealised gains and losses, parcels and holding periods to identify tax-loss harvesting and CGT minimisation opportunities before year end.',
    skill: 'tax-optimisation',
    context: ['client', 'holdings'],
    requiresApproval: false,
    fields: [
      { kind: 'client', key: 'clientId', label: 'Client', required: true },
      { kind: 'files', key: 'reports', label: 'Unrealised / realised CGT reports', accept: REPORT_ACCEPT, required: true },
      { kind: 'text', key: 'realisedGains', label: 'Realised gains this FY (if known)', required: false },
      { kind: 'text', key: 'carriedLosses', label: 'Carried-forward capital losses', required: false },
      { kind: 'textarea', key: 'notes', label: 'Constraints (e.g. hold positions, wash-sale concerns)', required: false },
    ],
    expectedOutputs: ['Harvesting schedule (.xlsx)', 'Tax opportunities memo (.docx)'],
  },
  {
    id: 'annual-review',
    name: 'Annual Review',
    short: 'Review report and Ongoing Fee Arrangement from the year’s activity',
    description:
      'Reads platform reports plus the year’s emails, meetings and notes for the client, then drafts a personalised annual review report and the Ongoing Fee Arrangement (OFA) renewal.',
    skill: 'annual-review',
    context: ['client', 'holdings', 'emails', 'meetings', 'notes', 'tasks'],
    requiresApproval: true,
    fields: [
      { kind: 'client', key: 'clientId', label: 'Client', required: true },
      { kind: 'files', key: 'platformReports', label: 'Platform reports (performance, transactions, fees, tax)', accept: REPORT_ACCEPT, required: true },
      { kind: 'date', key: 'periodStart', label: 'Review period start', required: true },
      { kind: 'date', key: 'periodEnd', label: 'Review period end', required: true },
      { kind: 'text', key: 'ongoingFee', label: 'Proposed ongoing fee', placeholder: '$5,500 p.a. incl. GST', required: true },
      { kind: 'textarea', key: 'adviserNotes', label: 'Adviser notes for the review', required: false },
    ],
    expectedOutputs: ['Annual review report (.docx)', 'Ongoing Fee Arrangement (.docx)'],
  },
  {
    id: 'soa-roa',
    name: 'SOA / ROA Generator',
    short: 'Advice documents for investment and platform switches',
    description:
      'Drafts a Statement of Advice or Record of Advice for an investment switch or platform switch, including basis of advice, replacement product analysis and fee disclosure.',
    skill: 'soa-roa',
    context: ['client', 'holdings', 'notes'],
    requiresApproval: true,
    fields: [
      { kind: 'client', key: 'clientId', label: 'Client', required: true },
      {
        kind: 'select',
        key: 'documentType',
        label: 'Document',
        required: true,
        options: [
          { value: 'SOA', label: 'Statement of Advice (SOA)' },
          { value: 'ROA', label: 'Record of Advice (ROA)' },
        ],
      },
      {
        kind: 'select',
        key: 'adviceType',
        label: 'Advice type',
        required: true,
        options: [
          { value: 'investment-switch', label: 'Investment switch' },
          { value: 'platform-switch', label: 'Platform switch' },
        ],
      },
      { kind: 'textarea', key: 'recommendation', label: 'Recommendation and reasons', required: true },
      { kind: 'files', key: 'supporting', label: 'Supporting files (current holdings, research, fee comparison output)', accept: REPORT_ACCEPT, required: false },
    ],
    expectedOutputs: ['SOA or ROA (.docx)'],
  },
];

export const TOOLS_BY_ID = Object.fromEntries(TOOLS.map((t) => [t.id, t])) as Record<ToolId, ToolDefinition>;

export function isToolId(value: string): value is ToolId {
  return value in TOOLS_BY_ID;
}
