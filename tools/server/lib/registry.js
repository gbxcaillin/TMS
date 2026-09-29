// The advice tools. The page renders each form from `fields`; the runner writes the declared `context` from the CRM
// into the run folder and asks the agent to run `skill` (agent/skills/<skill>/SKILL.md).
// `approval: true` marks compliance documents: they stay drafts until an adviser approves them.

const REPORTS = '.pdf,.csv,.xlsx,.xls,.docx';

export const TOOLS = [
  {
    id: 'fee-comparison',
    name: 'Fee comparison',
    short: 'Total cost of the current platform against alternatives, in dollars and percent.',
    skill: 'fee-comparison',
    context: ['client'],
    approval: false,
    fields: [
      { kind: 'client', key: 'clientId', label: 'Client', required: false },
      { kind: 'files', key: 'statements', label: 'Current statements or fee disclosures', accept: REPORTS, required: false },
      { kind: 'text', key: 'alternatives', label: 'Alternatives to compare', placeholder: 'HUB24 Choice, Netwealth Accelerator Core', required: true },
      { kind: 'text', key: 'balance', label: 'Balance to model (when no client is chosen)', placeholder: '$750,000', required: false },
    ],
    outputs: ['Fee comparison (.xlsx)', 'Summary for the file (.docx)'],
  },
  {
    id: 'product-comparison',
    name: 'Product feature comparison',
    short: 'Side-by-side features of platforms or products against what the client needs.',
    skill: 'product-comparison',
    context: ['client'],
    approval: false,
    fields: [
      { kind: 'client', key: 'clientId', label: 'Client', required: false },
      { kind: 'text', key: 'products', label: 'Products to compare', placeholder: 'CFS Edge, Macquarie Wrap, Praemium', required: true },
      { kind: 'textarea', key: 'needs', label: 'Client needs and must-haves', required: false },
      { kind: 'files', key: 'pds', label: 'PDS or product guides', accept: '.pdf,.docx', required: false },
    ],
    outputs: ['Feature comparison (.xlsx)', 'Comparison summary (.docx)'],
  },
  {
    id: 'tax-optimisation',
    name: 'Tax minimisation and loss harvesting',
    short: 'Unrealised gains and losses, parcels and holding periods: what to realise before 30 June.',
    skill: 'tax-optimisation',
    context: ['client'],
    approval: false,
    fields: [
      { kind: 'client', key: 'clientId', label: 'Client', required: true },
      { kind: 'files', key: 'reports', label: 'Realised and unrealised CGT reports', accept: REPORTS, required: true },
      { kind: 'text', key: 'realisedGains', label: 'Gains already realised this financial year', required: false },
      { kind: 'text', key: 'carriedLosses', label: 'Carried-forward capital losses', required: false },
      { kind: 'textarea', key: 'constraints', label: 'Constraints (positions to hold, wash-sale concerns)', required: false },
    ],
    outputs: ['Harvesting schedule (.xlsx)', 'Tax opportunities memo (.docx)'],
  },
  {
    id: 'annual-review',
    name: 'Annual review',
    short: 'Reads the platform reports and the year’s emails, meetings and notes; drafts the review and the OFA.',
    skill: 'annual-review',
    context: ['client', 'emails', 'meetings', 'notes', 'tasks'],
    approval: true,
    fields: [
      { kind: 'client', key: 'clientId', label: 'Client', required: true },
      { kind: 'files', key: 'platformReports', label: 'Platform reports (performance, transactions, fees, tax)', accept: REPORTS, required: true },
      { kind: 'date', key: 'periodStart', label: 'Review period from', required: true },
      { kind: 'date', key: 'periodEnd', label: 'Review period to', required: true },
      { kind: 'text', key: 'ongoingFee', label: 'Proposed ongoing fee', placeholder: '$5,500 a year incl. GST', required: true },
      { kind: 'textarea', key: 'adviserNotes', label: 'Adviser notes for the review', required: false },
    ],
    outputs: ['Annual review report (.docx)', 'Ongoing Fee Arrangement (.docx)'],
  },
  {
    id: 'soa-roa',
    name: 'SOA / ROA',
    short: 'Statement or Record of Advice for an investment switch or a platform switch.',
    skill: 'soa-roa',
    context: ['client', 'notes'],
    approval: true,
    fields: [
      { kind: 'client', key: 'clientId', label: 'Client', required: true },
      { kind: 'select', key: 'documentType', label: 'Document', required: true, options: [{ value: 'SOA', label: 'Statement of Advice (SOA)' }, { value: 'ROA', label: 'Record of Advice (ROA)' }] },
      { kind: 'select', key: 'adviceType', label: 'Advice', required: true, options: [{ value: 'investment-switch', label: 'Investment switch' }, { value: 'platform-switch', label: 'Platform switch' }] },
      { kind: 'textarea', key: 'recommendation', label: 'Recommendation and the reasons for it', required: true },
      { kind: 'files', key: 'supporting', label: 'Supporting files (holdings, research, fee comparison)', accept: REPORTS, required: false },
    ],
    outputs: ['SOA or ROA (.docx)'],
  },
];

export const TOOL = Object.fromEntries(TOOLS.map((t) => [t.id, t]));
