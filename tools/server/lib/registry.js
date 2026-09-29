// The advice tools. The page renders each form from `fields`; the runner writes the declared `context` from the CRM
// into the run folder and asks the agent to run `skill` (agent/skills/<skill>/SKILL.md).
//
// `approval`: 'advice' marks compliance documents, which stay drafts until an adviser (APPROVER_ROLES) approves them;
// 'data' marks a record anyone with the tools can confirm; false means documents are ready as soon as they are made.
// `decides`: when set, only that output file needs the decision; the other outputs are ready straight away.
// `context: 'profile'` gives the run the client's confirmed profile as context/client-profile.json.

const REPORTS = '.pdf,.csv,.xlsx,.xls,.docx';

export const PROFILE_FILE = 'client-profile.json';

export const TOOLS = [
  {
    id: 'client-profile',
    name: 'Client profile',
    short: 'Reads the client’s documents, in any format, into one structured record the other tools work from.',
    skill: 'client-profile',
    context: ['client', 'emails', 'meetings', 'notes', 'tasks', 'profile'],
    approval: 'data',
    decides: PROFILE_FILE,
    atLeastOne: ['documents', 'corrections'],
    fields: [
      { kind: 'client', key: 'clientId', label: 'Client', required: true },
      {
        kind: 'files', key: 'documents', label: 'Documents', required: false,
        accept: '.pdf,.xlsx,.xlsm,.xls,.csv,.docx,.doc,.eml,.txt,.json,.png,.jpg,.jpeg,.heic,.webp',
        help: 'Fact Finder, KYC note, super and platform statements, holdings and CGT reports, insurance schedules, screenshots, emails. Any mix.',
      },
      { kind: 'textarea', key: 'corrections', label: 'Corrections or instructions', placeholder: 'Salary is $105,000 from 1 July, confirmed by phone.', required: false },
    ],
    outputs: ['Client profile (.json)', 'Readable summary (.md)'],
  },
  {
    id: 'fee-comparison',
    name: 'Fee comparison',
    short: 'Total cost of the current platform against alternatives, in dollars and percent.',
    skill: 'fee-comparison',
    context: ['client', 'profile'],
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
    context: ['client', 'profile'],
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
    context: ['client', 'profile'],
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
    context: ['client', 'profile', 'emails', 'meetings', 'notes', 'tasks'],
    approval: 'advice',
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
    context: ['client', 'profile', 'notes'],
    approval: 'advice',
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
