import {defaultSettings, type State, type Doc, type Event, today, totals} from './books';
export function demoState(): State {
  const date = today(),
    shift = (n: number) => {
      const d = new Date(date + 'T12:00:00Z');
      d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().slice(0, 10);
    };
  const settings = {
    ...defaultSettings,
    name: 'Coastal Plumbing · Sample business',
    gst: 'yes' as const,
    gstBasis: 'cash' as const,
    abn: 'Sample ABN',
    address: 'Gold Coast, Queensland',
  };
  const events: Event[] = [];
  const add = (kind: string, payload: any) =>
    events.push({id: 'sample-' + events.length, kind, payload, createdAt: date + 'T10:00:00Z'});
  const rows = [
    [
      'invoice',
      'INV-1001',
      'Harbour Property Group',
      'Hot water system replacement',
      '4850',
      -24,
      -10,
      '400',
      'Southport · J-1042',
    ],
    [
      'invoice',
      'INV-1002',
      'Sarah Mitchell',
      'Blocked drain & CCTV inspection',
      '780',
      -10,
      4,
      '400',
      'Ashmore · J-1048',
    ],
    [
      'invoice',
      'INV-1003',
      'Burleigh Build Co.',
      'Bathroom rough-in · Stage 1',
      '6250',
      -16,
      -2,
      '400',
      'Burleigh · J-1045',
    ],
    [
      'invoice',
      'INV-1004',
      'Michael Wilson',
      'Gas cooktop installation',
      '480',
      -2,
      12,
      '420',
      'Benowa · J-1051',
    ],
    [
      'bill',
      'BILL-001',
      'Plumbing supplier · Sample',
      'Hot water cylinder and fittings',
      '2150',
      -22,
      -8,
      '500',
      'Southport · J-1042',
    ],
    [
      'bill',
      'BILL-002',
      'Trade supplies · Sample',
      'Copper pipe & rough-in materials',
      '1340',
      -8,
      6,
      '500',
      'Burleigh · J-1045',
    ],
    [
      'bill',
      'BILL-003',
      'Office software · Sample',
      'Monthly subscription',
      '95',
      -3,
      11,
      '550',
      'Administration',
    ],
  ];
  rows.forEach((r, i) => {
    const d: Doc = {
      id: 'sample-doc-' + i,
      type: r[0] as Doc['type'],
      number: String(r[1]),
      contact: String(r[2]),
      contactAddress: 'Gold Coast, QLD',
      contactAbn: '',
      date: shift(Number(r[5])),
      due: shift(Number(r[6])),
      job: String(r[8]),
      reference: '',
      notes: 'Fictional sample record.',
      inclusive: false,
      lines: [
        {
          description: String(r[3]),
          qty: '1',
          price: String(r[4]),
          tax: 'gst',
          account: String(r[7]),
        },
      ],
      seller: settings,
    };
    add('document', d);
    if (i !== 3) add('post', {docId: d.id});
    if (i === 0 || i === 4) {
      const bankId = 'sample-bank-' + i;
      add('bank', {
        id: bankId,
        date: shift(-7),
        description: String(r[2]),
        amount: totals(d).total * (d.type === 'invoice' ? 1 : -1),
        reference: 'DEMO-' + i,
      });
      add('settle', {docId: d.id, bankId, date: shift(-7)});
    }
  });
  add('bank', {
    id: 'sample-bank-pending',
    date: shift(-1),
    description: 'SARAH MITCHELL INV-1002',
    amount: 85800,
    reference: 'DEMO-8',
  });
  add('bank', {
    id: 'sample-bank-fuel',
    date: date,
    description: 'Fuel purchase · Sample',
    amount: -9625,
    reference: 'DEMO-9',
  });
  rows.forEach((r, i) => {
    const contactId = 'sample-contact-' + i;
    add('contact', {
      id: contactId,
      name: String(r[2]),
      role: r[0] === 'invoice' ? 'customer' : 'supplier',
      email: '',
      phone: '',
      address: 'Gold Coast, QLD · Fictional sample',
      abn: '',
      notes: 'Fictional sample contact.',
      termsDays: 14,
      contractor: false,
      archived: false,
    });
    const doc = events.find((e) => e.kind === 'document' && e.payload.id === 'sample-doc-' + i);
    if (doc) doc.payload.contactId = contactId;
  });
  add('product', {
    id: 'sample-item-labour',
    code: 'LABOUR',
    name: 'Plumbing labour · Sample',
    description: 'General plumbing labour',
    salePrice: '125.00',
    costPrice: '0.00',
    tax: 'gst',
    saleAccount: '400',
    costAccount: '510',
    archived: false,
  });
  add('product', {
    id: 'sample-item-callout',
    code: 'CALLOUT',
    name: 'Call-out · Sample',
    description: 'Attendance and initial inspection',
    salePrice: '95.00',
    costPrice: '0.00',
    tax: 'gst',
    saleAccount: '400',
    costAccount: '590',
    archived: false,
  });
  add('bank_rule', {
    id: 'sample-fuel-rule',
    name: 'Fuel purchases · Sample',
    contains: 'fuel',
    direction: 'out',
    account: '520',
    tax: 'gst',
    archived: false,
  });
  for (const [type, name, price, account] of [
    ['quote', 'Bathroom renovation estimate', '2800', '400'],
    ['purchase_order', 'Bathroom fittings order', '850', '500'],
  ]) {
    const id = 'sample-' + type;
    add('document', {
      id,
      type,
      number: type === 'quote' ? 'QUO-1001' : 'PO-1001',
      contact: type === 'quote' ? 'Harbour Property Group' : 'Trade supplies · Sample',
      contactId: type === 'quote' ? 'sample-contact-0' : 'sample-contact-5',
      contactAddress: 'Gold Coast, QLD',
      contactAbn: '',
      date: shift(-2),
      due: shift(12),
      job: 'Burleigh · J-1055',
      reference: '',
      notes: 'Fictional sample document.',
      inclusive: false,
      lines: [{description: name, qty: '1', price, tax: 'gst', account}],
      seller: settings,
    });
    add('workflow_status', {docId: id, status: 'issued'});
  }
  add('asset', {
    id: 'sample-asset',
    name: 'Drain inspection camera · Sample',
    serial: 'DEMO-ONLY',
    purchaseDate: shift(-90),
    cost: 420000,
    residual: 20000,
    lifeMonths: 60,
    notes: 'Illustrative register entry only. No ledger posting.',
    archived: false,
  });
  return {events, settings};
}
