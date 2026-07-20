import { createClient } from "@supabase/supabase-js";

const SUPA_URL = "https://xusqjotoyntnfysquvlv.supabase.co";
const SUPA_KEY = "sb_publishable_HQigRx1Q8I6OpPffXMxRZQ_iqegVCka";

export const supabase = createClient(SUPA_URL, SUPA_KEY);
