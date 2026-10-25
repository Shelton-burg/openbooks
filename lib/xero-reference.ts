export type XeroReference = {
  sourceId: string;
  receivedOn: string;
  company: string;
  note: string;
  invoices: {
    total: number;
    count: number;
    overdue: number;
    overdueCount: number;
    draftCount: number;
    draftTotal: number;
  };
  bills: {
    total: number;
    count: number;
    overdue: number;
    overdueCount: number;
    draftCount: number;
    draftTotal: number;
  };
  banks: {
    account: string;
    name: string;
    statementBalance: number;
    statementDateLabel: string;
    bookBalance: number | null;
    unreconciled: number | null;
  }[];
  cash: {in: number; out: number; net: number; periodLabel: string};
  profit: {amount: number; from: string; to: string; changePercent: number};
  activityStatement: {periodLabel: string; dueLabel: string};
  mappings: {
    sourceCode: string;
    sourceName: string;
    targetCode: string | null;
    targetName: string;
    note: string;
  }[];
};
