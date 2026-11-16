import { useAuth } from '../contexts/AuthContext';
import { useModules } from '../stores/modulesStore';

// Whether the Team tab has anything for this viewer: the work schedule
// (every member sees their own shifts), the calendar and messages - while
// the business uses the team module - or payroll and absences, while it
// uses payroll and the viewer may manage them.
export function useShowTeamTab(): boolean {
  const { hasPermission, user } = useAuth();
  const { uses } = useModules();
  return (
    (uses('team') && (!!user?.company_id || hasPermission('team_collaboration'))) ||
    (uses('payroll') && (hasPermission('manage_payroll') || hasPermission('manage_budget')))
  );
}
