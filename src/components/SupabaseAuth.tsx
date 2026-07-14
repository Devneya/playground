import { Box, Button, Divider, Stack } from "@mui/material";
import { ThemeSupa } from "@supabase/auth-ui-shared";
import { Auth } from "@supabase/auth-ui-react";
import { SupabaseClient } from "@supabase/supabase-js";
import { useState } from "react";
import { signInWithOAuthRedirect } from "../supabase";

type AuthProps = {
  supabase: SupabaseClient<any, "public", any>;
};

// Deliberately not using <Auth providers={["google","github"]}>'s built-in
// social buttons: auth-ui-react calls supabaseClient.auth.signInWithOAuth
// with no way to pass skipBrowserRedirect via props, so it always navigates
// straight to the (broken, against bare GoTrue) /auth/v1/authorize path.
// These buttons call signInWithOAuthRedirect instead, which rewrites that
// path itself before navigating. See supabase.ts.
export default function SupabaseAuth(props: AuthProps) {
  const [error, setError] = useState<string | null>(null);

  const handleOAuth = async (provider: "google" | "github") => {
    setError(null);
    try {
      await signInWithOAuthRedirect(provider);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Box
      sx={{
        margin: "15vh auto 0",
        padding: "20px",
        maxWidth: "30vw",
        minWidth: "320px",
        border: "1px solid lightgrey",
        borderRadius: "4px",
      }}
    >
      <Stack gap="8px" sx={{ marginBottom: "16px" }}>
        <Button variant="outlined" onClick={() => handleOAuth("google")}>
          Continue with Google
        </Button>
        <Button variant="outlined" onClick={() => handleOAuth("github")}>
          Continue with GitHub
        </Button>
        {error && (
          <Box sx={{ color: "error.main", fontSize: "0.875rem" }}>{error}</Box>
        )}
      </Stack>
      <Divider sx={{ marginBottom: "16px" }}>or</Divider>
      <Auth
        supabaseClient={props.supabase}
        appearance={{
          theme: ThemeSupa,
          className: {
            button: "custom-auth-button",
          },
        }}
      />
    </Box>
  );
}
