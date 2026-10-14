// Database types. Keep in sync with supabase/migrations, or regenerate with:
//   npx supabase gen types typescript --local > src/lib/database.types.ts

export type DigitsPref = 'native' | 'latin';
export type CalendarPref = 'gregory' | 'persian' | 'islamic';

// `type`, not `interface`: supabase-js needs these to satisfy Record<string, unknown>.
export type ProfileRow = {
  id: string;
  display_name: string;
  avatar_path: string | null;
  phone: string | null;
  email: string | null;
  language: string;
  default_currency: string;
  digits: DigitsPref;
  calendar: CalendarPref;
  created_at: string;
  updated_at: string;
};

export type ProfileUpdate = Partial<
  Pick<ProfileRow, 'display_name' | 'avatar_path' | 'language' | 'default_currency' | 'digits' | 'calendar'>
>;

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: { id: string } & ProfileUpdate;
        Update: ProfileUpdate;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
