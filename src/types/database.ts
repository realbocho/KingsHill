export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id:           string;
          telegram_id:  number;
          username:     string | null;
          first_name:   string | null;
          last_name:    string | null;
          photo_url:    string | null;
          wallet:       number;
          withdrawable_balance: number;
          total_earned: number;
          total_spent:  number;
          is_bot:       boolean;
          referred_by:  string | null;
          referral_count: number;
          total_bonus_received: number;
          first_bid_done: boolean;
          first_deposit_done: boolean;
          created_at:   string;
          updated_at:   string;
        };
        Insert: Omit<Database['public']['Tables']['users']['Row'], 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['users']['Insert']>;
      };
      ad_slots: {
        Row: {
          id:                  string;
          name:                string;
          tier:                string;
          position:            number;
          width_units:         number;
          height_units:        number;
          base_price:          number;
          min_increment_pct:   number;
          created_at:          string;
        };
      };
      occupancies: {
        Row: {
          id:          string;
          slot_id:     string;
          user_id:     string;
          bid_amount:  number;
          ad_text:     string | null;
          ad_url:      string | null;
          ad_emoji:    string | null;
          ad_color:    string | null;
          ad_image_path: string | null;
          expires_at:  string;
          is_active:   boolean;
          created_at:  string;
          removed_by_admin: boolean;
          removal_reason:   string | null;
          removed_at:       string | null;
          removed_by:       string | null;
        };
      };
      bid_history: {
        Row: {
          id:            string;
          slot_id:       string;
          bidder_id:     string;
          displaced_id:  string | null;
          bid_amount:    number;
          premium_paid:  number;
          platform_fee:  number;
          refund_amount: number;
          ad_text:       string | null;
          ad_url:        string | null;
          ad_emoji:      string | null;
          ad_color:      string | null;
          created_at:    string;
        };
      };
      wallet_transactions: {
        Row: {
          id:            string;
          user_id:       string;
          type:          string;
          amount:        number;
          balance_after: number;
          reference_id:  string | null;
          description:   string | null;
          created_at:    string;
        };
      };
      platform_stats: {
        Row: {
          id:                    string;
          total_bids:            number;
          total_volume:          number;
          total_users:           number;
          total_fees_collected:  number;
          updated_at:            string;
        };
      };
      admins: {
        Row: {
          id:          string;
          telegram_id: number;
          label:       string | null;
          created_at:  string;
        };
      };
      reports: {
        Row: {
          id:            string;
          occupancy_id:  string;
          reporter_id:   string | null;
          reason:        string;
          status:        string;
          created_at:    string;
        };
      };
    };
    Functions: {
      upsert_telegram_user: {
        Args: {
          p_telegram_id: number;
          p_username:    string | null;
          p_first_name:  string | null;
          p_last_name:   string | null;
          p_photo_url:   string | null;
        };
        Returns: Database['public']['Tables']['users']['Row'];
      };
      place_bid: {
        Args: {
          p_slot_id:        string;
          p_user_id:        string;
          p_bid_amount:     number;
          p_duration_hours: number;
          p_ad_text:        string | null;
          p_ad_url:         string | null;
          p_ad_emoji:       string | null;
          p_ad_color:       string | null;
        };
        Returns: Json;
      };
    };
  };
}

export type User = Database['public']['Tables']['users']['Row'];
export type AdSlot = Database['public']['Tables']['ad_slots']['Row'];
export type Occupancy = Database['public']['Tables']['occupancies']['Row'];
export type BidHistory = Database['public']['Tables']['bid_history']['Row'];
export type WalletTx = Database['public']['Tables']['wallet_transactions']['Row'];
export type PlatformStats = Database['public']['Tables']['platform_stats']['Row'];

export interface SlotWithOccupancy extends AdSlot {
  current_occupancy: (Occupancy & { user: User | null }) | null;
  min_bid: number;
}
