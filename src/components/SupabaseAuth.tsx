import { Box } from "@mui/material";
import { ThemeSupa } from "@supabase/auth-ui-shared";
import { Auth } from "@supabase/auth-ui-react";
import { SupabaseClient } from "@supabase/supabase-js";

type AuthProps = {
  supabase: SupabaseClient<any, "public", any>;
};

export default function SupabaseAuth(props: AuthProps) {
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
      <Auth
        providers={["google", "github"]}
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
