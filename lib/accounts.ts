export type AccountDefinition = {
  code: string;
  name: string;
  masterColumn: string;
  sortOrder: number;
};

export const ACCOUNTS: AccountDefinition[] = [
  { code: 'daraz', name: 'Daraz', masterColumn: 'Daraz', sortOrder: 1 },
  { code: 'pandamart', name: 'Pandamart', masterColumn: 'Pandamart', sortOrder: 2 },
  { code: 'shajgoj', name: 'Shajgoj', masterColumn: 'Shajgoj', sortOrder: 3 },
  { code: 'cartup', name: 'Cartup', masterColumn: 'Cartup', sortOrder: 4 },
  { code: 'othoba', name: 'Othoba', masterColumn: 'Othoba', sortOrder: 5 },
  { code: 'foodi', name: 'Foodimart', masterColumn: 'Foodimart', sortOrder: 6 },
  { code: 'chaldal', name: 'Chaldal', masterColumn: 'Chaldal', sortOrder: 7 },
  { code: 'rokomari', name: 'Rokomari', masterColumn: 'Rokomari', sortOrder: 8 },
  { code: 'ogerio', name: 'Ogerio', masterColumn: 'Ogerio', sortOrder: 9 },
  { code: 'chardike', name: 'Chardike', masterColumn: 'Chardike', sortOrder: 10 },
  { code: 'arogga', name: 'Arogga', masterColumn: 'Arogga', sortOrder: 11 },
  { code: 'meenabazar', name: 'Meena Bazar', masterColumn: 'Meena Bazar', sortOrder: 12 },
  { code: 'shwapno', name: 'Shwapno', masterColumn: 'Shwapno', sortOrder: 13 },
];

export const ACCOUNT_BY_CODE = Object.fromEntries(ACCOUNTS.map((a) => [a.code, a]));
