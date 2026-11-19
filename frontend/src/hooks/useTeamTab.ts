import { useAuth } from '../contexts/AuthContext';
import { useModules } from '../stores/modulesStore';

// Whether the Team tab has anything for this viewer: the work schedule
// (every member sees their own shifts), the calendar and messages - while
// the business uses the team module - or payroll and absences, while it
// uses payroll and the viewer may manage them. And for whoever enters the
// till's revenue but has no Home (no statistics), Team is where they land
// and enter it - with or without the team module.
export function useShowTeamTab(): boolean {
  const { hasPermission, user } = useAuth();
  const { uses } = useModules();
  return (
    (uses('team') && (!!user?.company_id || hasPermission('team_collaboration'))) ||
    (uses('payroll') && (hasPermission('manage_payroll') || hasPermission('manage_budget'))) ||
    (uses('till') && hasPermission('add_revenue') && !hasPermission('view_statistics'))
  );
}
