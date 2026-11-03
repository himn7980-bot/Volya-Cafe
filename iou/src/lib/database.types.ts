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
  card_hidden: boolean;
  created_at: string;
  updated_at: string;
};

export type ProfileUpdate = Partial<
  Pick<ProfileRow, 'display_name' | 'avatar_path' | 'language' | 'default_currency' | 'digits' | 'calendar' | 'card_hidden'>
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
  auto_remind: boolean;
  status: LoanStatusDb;
  share_token: string;
  version: number;
  created_at: string;
  updated_at: string;
};

export type LoanInsert = Pick<LoanRow, 'counterparty_name' | 'amount_minor' | 'currency'> &
  Partial<Pick<LoanRow, 'id' | 'lender_id' | 'borrower_id' | 'counterparty_phone' | 'note' | 'loan_date' | 'due_date' | 'auto_remind'>>;

export type LoanUpdate = Partial<
  Pick<
    LoanRow,
    'counterparty_name' | 'counterparty_phone' | 'amount_minor' | 'currency' | 'note' | 'loan_date' | 'due_date' | 'photo_path' | 'auto_remind' | 'status'
  >
>;

export type RepaymentRow = {
  id: string;
  loan_id: string;
  amount_minor: number;
  paid_on: string;
  note: string;
  created_by: string | null;
  status: 'pending' | 'confirmed' | 'disputed' | 'cancelled';
  responded_by: string | null;
  responded_at: string | null;
  response_comment: string | null;
  created_at: string;
  updated_at: string;
};

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
      repayments: {
        Row: RepaymentRow;
        Insert: Pick<RepaymentRow, 'id' | 'loan_id' | 'amount_minor' | 'paid_on' | 'note'>;
        Update: Pick<RepaymentRow, 'status'>;
        Relationships: [];
      };
      loan_versions: {
        Row: LoanVersionRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      loan_extensions: {
        Row: {
          id: string;
          loan_id: string;
          proposed_by: string | null;
          old_due_date: string;
          new_due_date: string;
          reason: string;
          status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
          created_at: string;
          responded_at: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      card_links: {
        Row: { token: string; user_id: string; created_at: string; expires_at: string; revoked_at: string | null };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      my_counterparts: {
        Args: Record<string, never>;
        Returns: { id: string; display_name: string; language: string; avatar_path: string | null }[];
      };
      claim_shared_loan: { Args: { p_token: string }; Returns: string };
      claim_loans_by_phone: { Args: Record<string, never>; Returns: number };
      respond_to_loan: { Args: { p_loan_id: string; p_action: 'confirm' | 'dispute'; p_comment: string | null }; Returns: string };
      respond_to_repayment: {
        Args: { p_repayment_id: string; p_action: 'confirm' | 'dispute'; p_comment: string | null };
        Returns: string;
      };
      send_reminder: {
        Args: { p_loan_id: string; p_tone: 'gentle' | 'neutral' | 'firm'; p_channel: 'push' | 'share' };
        Returns: { ok?: boolean; error?: 'too_soon' | 'not_open' | 'no_account'; next_at?: string };
      };
      register_push_token: { Args: { p_token: string; p_platform: string }; Returns: undefined };
      unregister_push_token: { Args: { p_token: string }; Returns: undefined };
      my_trust: { Args: Record<string, never>; Returns: unknown };
      trust_card_for_loan: { Args: { p_loan_id: string }; Returns: unknown };
      trust_card_by_token: { Args: { p_token: string }; Returns: unknown };
      create_card_link: { Args: { p_days: number }; Returns: { token: string; expires_at: string } };
      revoke_card_link: { Args: { p_token: string }; Returns: undefined };
      propose_extension: { Args: { p_loan_id: string; p_new_due: string; p_reason: string }; Returns: string };
      respond_to_extension: { Args: { p_extension_id: string; p_action: 'accept' | 'reject' | 'cancel' }; Returns: string };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
