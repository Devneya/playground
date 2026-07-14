import "font-awesome/css/font-awesome.min.css";
import { useEffect, useRef, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import "reactflow/dist/style.css";
import "./App.css";
import Flow from "./components/Flow";
import theme from "./themes";

import { Session } from "@supabase/supabase-js";
import SupabaseAuth from "./components/SupabaseAuth";
import { SessionContext, VirtualKeyContext } from "./context/supabaseContext";
import { supabase } from "./supabase";

import { Box, CircularProgress, ThemeProvider } from "@mui/material";
import { SnackbarProvider } from "notistack";
import { useLocalStorage } from "./hooks/useLocalStorage";
import { initAutosave, stopAutosave } from "./logic/flowAutosave";
import { preloadTemplates } from "./components/Templates/templateLoader";

export default function App() {
  // State to manage the current user session
  const [session, setSession] = useState<Session | null>(null);

  // State to track if the session is still loading
  const [isLoadingSession, setIsLoadingSession] = useState(true);

  // State to manage whether to suggest entering a name
  const [suggestEnterName, setSuggestEnterName] = useLocalStorage(
    "suggest_to_enter_name",
    "true"
  );

  // State to store the fetched virtual key
  const [virtualKey, setVirtualKey] = useState<string | null>(null);

  // Effect to initialize the session and listen for Supabase authentication state changes
  useEffect(() => {
    if (suggestEnterName !== false) setSuggestEnterName(true);

    console.log("Loading session...");
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsLoadingSession(true);
      setSession(session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setIsLoadingSession(false);
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    initAutosave();
    return () => {
      stopAutosave();
    };
  }, []);

  // Preload templates
  useEffect(() => {
    const manifestUrl = import.meta.env.VITE_TEMPLATES_INDEX_URL;
    if (manifestUrl) {
      preloadTemplates(manifestUrl).catch((error: any) => {
        console.error("Error preloading templates:", error.toString());
      });
    }
  }, []);

  // Ref to store the interval ID for retrying virtual key fetch
  const intervalRef = useRef<NodeJS.Timeout | null>(
    null
  ) as React.RefObject<NodeJS.Timeout | null>;

  /**
   * Fetch the virtual key from the server.
   * @param session - Current user session
   * @param setVirtualKey - Function to update the virtual key state
   * @param intervalRef - Ref to manage the retry interval
   * @returns {Promise<boolean>} - Whether the fetch was successful
   */
  const fetchVirtualKey = async (
    session: Session | null,
    setVirtualKey: React.Dispatch<React.SetStateAction<string | null>>,
    intervalRef: React.RefObject<NodeJS.Timeout | null>
  ): Promise<boolean> => {
    if (session !== null && import.meta.env.VITE_PROXY_URL !== undefined) {
      try {
        const resp = await fetch(
          `${import.meta.env.VITE_PROXY_URL}/account/key`,
          {
            method: "GET",
            headers: {
              Authorization: "Bearer " + session.access_token,
              "Content-Type": "application/json",
            },
          }
        );

        const respData = await resp.json();
        const virtualKey = respData["key"];
        if (typeof virtualKey === "string" && virtualKey.startsWith("sk-")) {
          setVirtualKey(virtualKey);

          // Clear the interval if it exists
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }

          return true; // Successfully fetched
        } else {
          console.log("Invalid virtual key.");
        }
      } catch (e) {
        setVirtualKey(null);
        console.log("Failed to fetch virtual key:", e);
      }
    }
    return false; // Failed to fetch
  };

  /**
   * Attempt to load the virtual key, retrying if necessary.
   * @param session - Current user session
   * @param setVirtualKey - Function to update the virtual key state
   * @param intervalRef - Ref to manage the retry interval
   */
  const loadVirtualKey = (
    session: Session | null,
    setVirtualKey: React.Dispatch<React.SetStateAction<string | null>>,
    intervalRef: React.RefObject<NodeJS.Timeout | null>
  ) => {
    const attemptFetch = async () => {
      const success = await fetchVirtualKey(
        session,
        setVirtualKey,
        intervalRef
      );
      if (!success && !intervalRef.current) {
        intervalRef.current = setInterval(async () => {
          const retrySuccess = await fetchVirtualKey(
            session,
            setVirtualKey,
            intervalRef
          );
          if (retrySuccess) {
            clearInterval(intervalRef.current!); // Stop retrying once successful
            intervalRef.current = null;
          }
        }, 5000); // Retry every 5 seconds
      }
    };

    attemptFetch();
  };

  // Effect to load the virtual key when the session changes
  const didInitRef = useRef(false);
  useEffect(() => {
    if (!didInitRef.current) {
      didInitRef.current = true;
      if (session) {
        loadVirtualKey(session, setVirtualKey, intervalRef);
      }
      return () => {
        // Cleanup interval on component unmount or session change
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      };
    }
  }, [session]);

  // State to manage the recently saved status
  const [recentlySaved, setRecentlySaved] = useState(false);

  // Effect to reset the recently saved status after a delay
  useEffect(() => {
    if (recentlySaved) {
      const toRef = setTimeout(() => {
        setRecentlySaved(false);
        clearTimeout(toRef);
      }, 700);
    }
  }, [recentlySaved]);

  // Render the application based on the session and loading state
  if (!isLoadingSession) {
    if (!session) {
      // Render the authentication component if no session exists
      return <SupabaseAuth supabase={supabase} />;
    } else {
      // Render the main application if a session exists
      return (
        <ThemeProvider theme={theme}>
          <SnackbarProvider maxSnack={3} style={{ right: "20px" }}>
            <SessionContext.Provider value={session}>
              <VirtualKeyContext.Provider value={virtualKey}>
                <div className="flowContainer">
                  <ReactFlowProvider>
                    <Flow />
                  </ReactFlowProvider>
                </div>
              </VirtualKeyContext.Provider>
            </SessionContext.Provider>
          </SnackbarProvider>
        </ThemeProvider>
      );
    }
  } else {
    // Render a loading spinner while the session is loading
    return (
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
        }}
      >
        <CircularProgress color="inherit" size="3rem" />
      </Box>
    );
  }
}
