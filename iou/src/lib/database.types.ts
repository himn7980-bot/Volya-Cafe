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

export type LoanStatusDb = 'pending' | 'confirmed' | 'disputed' | 'settled' | 'cancelled';

export type LoanRow = {
  id: string;
  creator_id: string;
  lender_id: string | null;
  borrower_id: string | null;
  counterparty_name: string;
  counterparty_phone: string | null;
  amount_minor: number;
  currency: string;
  note: string;
  loan_date: string;
  due_date: string | null;
  photo_path: string | null;
  status: LoanStatusDb;
  share_token: string;
  version: number;
  created_at: string;
  updated_at: string;
};

export type LoanInsert = Pick<LoanRow, 'counterparty_name' | 'amount_minor' | 'currency'> &
  Partial<Pick<LoanRow, 'id' | 'lender_id' | 'borrower_id' | 'counterparty_phone' | 'note' | 'loan_date' | 'due_date'>>;

export type LoanUpdate = Partial<
  Pick<LoanRow, 'counterparty_name' | 'counterparty_phone' | 'amount_minor' | 'currency' | 'note' | 'loan_date' | 'due_date' | 'photo_path' | 'status'>
>;

export type LoanVersionRow = {
  id: number;
  loan_id: string;
  version: number;
  changed_by: string | null;
  snapshot: Record<string, unknown>;
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: { id: string } & ProfileUpdate;
        Update: ProfileUpdate;
        Relationships: [];
      };
      loans: {
        Row: LoanRow;
        Insert: LoanInsert;
        Update: LoanUpdate;
        Relationships: [];
      };
      loan_versions: {
        Row: LoanVersionRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
