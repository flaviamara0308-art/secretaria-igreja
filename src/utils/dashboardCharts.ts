import type { Department, Member } from '../types';

export interface DepartmentDistributionSlice {
  id: string;
  name: string;
  value: number;
  percentage: number;
  color: string;
}

const CHART_COLORS = [
  '#1d4ed8', // Royal Blue
  '#059669', // Emerald
  '#d97706', // Amber
  '#7c3aed', // Violet
  '#0891b2', // Cyan
  '#db2777', // Pink
  '#4f46e5', // Indigo
  '#0d9488', // Teal
];

const UNASSIGNED_COLOR = '#94a3b8';

export function computeDepartmentDistribution(
  departments: Department[],
  members: Member[]
): {
  slices: DepartmentDistributionSlice[];
  totalActiveMembers: number;
  totalLinks: number;
} {
  const activeMembers = members.filter(m => m.status === 'ACTIVE');
  const activeDepts = departments.filter(d => d.status !== 'INACTIVE');
  const deptIdsSet = new Set(activeDepts.map(d => d.id));

  const countsByDept = new Map<string, number>();
  let unassignedCount = 0;

  for (const member of activeMembers) {
    const validDepts = (member.departmentIds || []).filter(id => deptIdsSet.has(id));
    if (validDepts.length === 0) {
      unassignedCount += 1;
    } else {
      for (const deptId of validDepts) {
        countsByDept.set(deptId, (countsByDept.get(deptId) || 0) + 1);
      }
    }
  }

  const rawItems: { id: string; name: string; value: number; isUnassigned?: boolean }[] = [];

  for (const dept of activeDepts) {
    const count = countsByDept.get(dept.id) || 0;
    if (count > 0) {
      rawItems.push({ id: dept.id, name: dept.name, value: count });
    }
  }

  rawItems.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, 'pt-BR'));

  if (unassignedCount > 0) {
    rawItems.push({
      id: 'unassigned',
      name: 'Sem Departamento',
      value: unassignedCount,
      isUnassigned: true,
    });
  }

  const totalLinks = rawItems.reduce((sum, item) => sum + item.value, 0);

  let colorIdx = 0;
  const slices: DepartmentDistributionSlice[] = rawItems.map(item => ({
    id: item.id,
    name: item.name,
    value: item.value,
    percentage: totalLinks > 0 ? Math.round((item.value / totalLinks) * 100) : 0,
    color: item.isUnassigned ? UNASSIGNED_COLOR : CHART_COLORS[colorIdx++ % CHART_COLORS.length],
  }));

  return {
    slices,
    totalActiveMembers: activeMembers.length,
    totalLinks,
  };
}
