export interface DashboardPanelPrefs {
  showQuickActions: boolean;
  showStats: boolean;
  showCalendar: boolean;
  showBirthdays: boolean;
}

export const DEFAULT_DASHBOARD_PREFS: DashboardPanelPrefs = {
  showQuickActions: true,
  showStats: true,
  showCalendar: true,
  showBirthdays: true,
};

const CHURCH_PREFS_PREFIX = 'sec_igreja_dashboard_prefs_church_';
const LEGACY_USER_PREFS_PREFIX = 'sec_igreja_dashboard_prefs_';

export function getChurchDashboardPrefsKey(churchId: string): string {
  return `${CHURCH_PREFS_PREFIX}${churchId}`;
}

export function loadDashboardPrefs(churchId: string, legacyUserId?: string): DashboardPanelPrefs {
  try {
    const churchRaw = localStorage.getItem(getChurchDashboardPrefsKey(churchId));
    if (churchRaw) {
      const parsed = JSON.parse(churchRaw);
      return {
        showQuickActions: typeof parsed.showQuickActions === 'boolean' ? parsed.showQuickActions : true,
        showStats: typeof parsed.showStats === 'boolean' ? parsed.showStats : true,
        showCalendar: typeof parsed.showCalendar === 'boolean' ? parsed.showCalendar : true,
        showBirthdays: typeof parsed.showBirthdays === 'boolean' ? parsed.showBirthdays : true,
      };
    }

    if (legacyUserId) {
      const legacyRaw = localStorage.getItem(`${LEGACY_USER_PREFS_PREFIX}${legacyUserId}`);
      if (legacyRaw) {
        const parsed = JSON.parse(legacyRaw);
        return {
          showQuickActions: typeof parsed.showQuickActions === 'boolean' ? parsed.showQuickActions : true,
          showStats: typeof parsed.showStats === 'boolean' ? parsed.showStats : true,
          showCalendar: typeof parsed.showCalendar === 'boolean' ? parsed.showCalendar : true,
          showBirthdays: typeof parsed.showBirthdays === 'boolean' ? parsed.showBirthdays : true,
        };
      }
    }
  } catch {
    // Ignore invalid localStorage payloads
  }

  return { ...DEFAULT_DASHBOARD_PREFS };
}

export function saveDashboardPrefs(churchId: string, prefs: DashboardPanelPrefs): void {
  try {
    localStorage.setItem(getChurchDashboardPrefsKey(churchId), JSON.stringify(prefs));
  } catch {
    // Ignore storage quota errors
  }
}
