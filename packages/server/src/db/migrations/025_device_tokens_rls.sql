-- Enable RLS on device_tokens (missed in 022 since the table was created later)
ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;
