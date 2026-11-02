export interface SubjectRecord {
  id: number;
  semester_id: number;
  name: string;
  code: string | null;
  target_percentage: number | null;
  created_at: string;
}
