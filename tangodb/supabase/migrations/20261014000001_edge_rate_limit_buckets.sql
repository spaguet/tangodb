-- S13 / H6: durable Edge Function rate limits (shared across isolates).

CREATE TABLE IF NOT EXISTS public.edge_rate_limit_buckets (
  bucket_key text PRIMARY KEY,
  count integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  reset_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS edge_rate_limit_buckets_reset_at_idx
  ON public.edge_rate_limit_buckets (reset_at);

CREATE OR REPLACE FUNCTION public.check_edge_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_count integer;
  v_reset_at timestamptz;
BEGIN
  IF p_key IS NULL OR length(trim(p_key)) = 0 OR p_limit <= 0 OR p_window_seconds <= 0 THEN
    RETURN false;
  END IF;

  SELECT b.count, b.reset_at
  INTO v_count, v_reset_at
  FROM public.edge_rate_limit_buckets b
  WHERE b.bucket_key = p_key
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.edge_rate_limit_buckets (bucket_key, count, reset_at)
    VALUES (p_key, 1, v_now + make_interval(secs => p_window_seconds));
    RETURN true;
  END IF;

  IF v_reset_at <= v_now THEN
    UPDATE public.edge_rate_limit_buckets
    SET count = 1,
        reset_at = v_now + make_interval(secs => p_window_seconds)
    WHERE bucket_key = p_key;
    RETURN true;
  END IF;

  IF v_count >= p_limit THEN
    RETURN false;
  END IF;

  UPDATE public.edge_rate_limit_buckets
  SET count = count + 1
  WHERE bucket_key = p_key;

  RETURN true;
END;
$$;

REVOKE ALL ON TABLE public.edge_rate_limit_buckets FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.edge_rate_limit_buckets TO service_role;

REVOKE ALL ON FUNCTION public.check_edge_rate_limit(text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_edge_rate_limit(text, integer, integer) TO service_role;
