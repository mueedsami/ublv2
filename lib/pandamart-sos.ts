export type PandamartSosBranch = {
  code: string;
  name: string;
  vendorId: string;
  vendorSlug: string;
};

// Vendor IDs recovered from the proven standalone Pandamart search scraper.
// These are the 10 branches currently safe to use for SoS search.
export const PANDAMART_SOS_BRANCHES: PandamartSosBranch[] = [
  { code: 'Bashundhara', name: 'Bashundhara', vendorId: 'h5rj', vendorSlug: 'pandamart-bashundhara' },
  { code: 'Dhanmondi', name: 'Dhanmondi', vendorId: 'ta7z', vendorSlug: 'pandamart-dhanmondi' },
  { code: 'Gulshan_1', name: 'Gulshan 1', vendorId: 'vbpl', vendorSlug: 'pandamart-gulshan-banani' },
  { code: 'Gulshan_2', name: 'Gulshan 2', vendorId: 'w2lx', vendorSlug: 'pandamart-gulshan-niketon' },
  { code: 'Uttara', name: 'Uttara', vendorId: 'n7ph', vendorSlug: 'pandamart-uttara' },
  { code: 'Mohammadpur', name: 'Mohammadpur', vendorId: 'bbus', vendorSlug: 'pandamart-mohammadpur' },
  { code: 'Mirpur_02', name: 'Mirpur 02', vendorId: 'kx59', vendorSlug: 'pandamart-mirpur-zoo-road' },
  { code: 'Wari', name: 'Wari', vendorId: 'zj9s', vendorSlug: 'pandamart-wari' },
  { code: 'Rampura', name: 'Rampura', vendorId: 'mfg7', vendorSlug: 'pandamart-rampura' },
  { code: 'Mogbazar', name: 'Mogbazar', vendorId: 'v1ts', vendorSlug: 'pandamart-mogbazar' },
];

export const DEFAULT_PANDAMART_SOS_BRANCH = 'Uttara';

export function getPandamartSosBranches(requestedCodes: unknown): PandamartSosBranch[] {
  if (!Array.isArray(requestedCodes) || requestedCodes.length === 0) {
    return PANDAMART_SOS_BRANCHES.filter((branch) => branch.code === DEFAULT_PANDAMART_SOS_BRANCH);
  }

  const requested = new Set(requestedCodes.map((value) => String(value || '').trim()).filter(Boolean));
  const branches = PANDAMART_SOS_BRANCHES.filter((branch) => requested.has(branch.code));
  return branches.length ? branches : PANDAMART_SOS_BRANCHES.filter((branch) => branch.code === DEFAULT_PANDAMART_SOS_BRANCH);
}
