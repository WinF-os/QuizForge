'use strict';
// Fill in with your Supabase project's URL and anon key (Project Settings -> API).
// These are safe to expose client-side -- the Gemini key itself stays server-side
// as a Supabase Edge Function secret. See README.md for setup.
const SUPABASE_URL = 'https://srsgrvqtopodyngfrjjh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNyc2dydnF0b3BvZHluZ2ZyampoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4NzI0MzQsImV4cCI6MjEwMDQ0ODQzNH0.R8Y4tzQ1SyuiyjMXDOMaXjhhgz9_zMrxm-T8Vg9hwbQ';

// For Profile -> Backup & Restore -> Google Drive. Leave blank to disable
// that option entirely (local phone backup still works either way). This
// must be a QuizForge-specific OAuth client -- see README.md's "Google
// Drive Backup Setup" section for exactly how to create one; a client ID
// from a different app (like Winfinity's) will not work here.
const GOOGLE_CLIENT_ID = '877281164872-ap9h374glpcf9qt47hs66r6hi4rctr9g.apps.googleusercontent.com';
