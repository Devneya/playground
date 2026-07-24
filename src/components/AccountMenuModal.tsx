import {
  AttachMoney,
  Close, DeleteOutline,
  Edit,
  HelpOutline,
  Logout,
  PersonOutline,
  Refresh,
  Save,
} from "@mui/icons-material";
import {
  Avatar,
  Box,
  Button,
  CircularProgress,
  Divider,
  IconButton, Link,
  ListItemIcon,
  MenuItem,
  MenuList,
  Modal,
  Stack,
  Typography,
} from "@mui/material";
import {Session} from "@supabase/supabase-js";
import React, {memo, useCallback, useContext, useEffect, useMemo, useState} from "react";
import {SessionContext, VirtualKeyContext} from "../context/supabaseContext";
import {supabase} from "../supabase";
import theme from "../themes";
import DeletePopover from "./DeletePopover";
import NodeButton from "./Buttons/NodeButton";
import SystemIconButton from "./Buttons/SystemIconButton";
import {deleteFile, uploadFile} from "../storage";
import {useAvatar} from "../logic/utils";
import {VisuallyHiddenInput} from "../themes/componentStyles";
import {useSnackbar} from "notistack";
import {
  cancelSubscription,
  fetchUsage,
  startSubscription,
  type UsageResponse,
} from "../logic/subscription";

function getFirstLetters(str: string) {
  return str.slice(0, 2).toUpperCase();
}

type AccountMenuProps = {
  session: Session | null;
  virtualKey: string | null;
  firstLetters: string;
  preferredName: string;
  setPreferredName: React.Dispatch<React.SetStateAction<string>>;
  changeNameStatus: boolean;
  setChangeNameStatus: React.Dispatch<React.SetStateAction<boolean>>;
  avatarPath?: string;
  setAvatarPath: React.Dispatch<React.SetStateAction<string | undefined>>
};

const AccountMenu = memo((props: AccountMenuProps) => {
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const avatarUrl = useAvatar(props.avatarPath);

  const handleAvatarUpload = async (file: File) => {
    if (!props.session) return;
    const {data} = await supabase.auth.getUser();
    const oldAvatarPath = data?.user?.user_metadata?.avatar_path ?? undefined;
    const avatarFileName = `avatar-${Date.now()}`;
    const newAvatarPath = `${props.session.user.id}/${avatarFileName}.png`;

    try {
      setAvatarUploading(true);
      const uploadError = await uploadFile(file, avatarFileName, props.session.user.id, props.session.access_token);
      if (uploadError) return console.log(uploadError);

      const {error} = await supabase.auth.updateUser({data: {avatar_path: newAvatarPath}});
      if (error) return console.log(error);

      props.setAvatarPath(newAvatarPath);
      if (oldAvatarPath) await deleteFile(props.session.access_token, oldAvatarPath);
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleAvatarDelete = async () => {
    if (!props.session || avatarUploading) return;
    setAvatarUploading(true);
    const {error} = await supabase.auth.updateUser({data: {avatar_path: null}});
    if (error) console.log(error);

    props.setAvatarPath(undefined);
    setAvatarUploading(false);
  };

  const handleSaveProfile = async () => {
    const {error} = await supabase.auth.updateUser({data: {name: props.preferredName}});
    if (error) console.log(error);
    setIsEditingProfile(false);
  };

  return (
    <Stack gap={"24px"}>
      <Stack padding={"0px 48px 0px 48px"} gap={"8px"}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography variant="subtitle1">
            My profile
          </Typography>
          <NodeButton
            func={() => {
              if (isEditingProfile) handleSaveProfile();
              else setIsEditingProfile(true);
            }}
            icon={isEditingProfile ? Save : Edit}
            toolTipValue={isEditingProfile ? "Save" : "Edit"}
            color="text.secondary"
          />
        </Stack>
        <Divider/>
        <Stack direction={"row"} gap={"8px"} alignItems={"center"}>
          <Avatar
            src={avatarUrl ?? undefined}
            sx={{
              width: "44px",
              height: "44px",
              bgcolor: "primary.main",
              color: "background.paper",
              opacity: avatarUploading ? 0.6 : 1,
            }}
          >
            {!avatarUrl && props.firstLetters}
          </Avatar>
          {isEditingProfile && (
            <Box
              sx={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <NodeButton
                func={(e) => {
                  e.stopPropagation();
                  if (!avatarUploading) {
                    fileInputRef.current?.click();
                  }
                }}
                icon={Edit}
                toolTipValue={"Change avatar"}
                color="text.secondary"
                iconSize={"small"}
                disabled={avatarUploading}
              />
              <NodeButton
                func={handleAvatarDelete}
                icon={DeleteOutline}
                toolTipValue={"Delete avatar"}
                color="error"
                iconSize={"small"}
                disabled={avatarUploading}
              />
            </Box>
          )}
          <VisuallyHiddenInput
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleAvatarUpload(file);
              e.target.value = "";
            }}
          />
          <Stack gap={"4px"} width={"30%"}>
            <Typography
              variant="caption"
              sx={{letterSpacing: "none"}}
              color={"text.secondary"}
            >
              Preferred name
            </Typography>
            <Stack
              direction={"row"}
              gap="4px"
              height={"1.5em"}
              justifyContent={"space-between"}
            >
              {!isEditingProfile ? (
                <Typography
                  variant={"caption"}
                  color={"text.primary"}
                  lineHeight="24px"
                  width={"200px"}
                  overflow={"hidden"}
                >
                  {props.preferredName}
                </Typography>
              ) : (
                <input
                  disabled={false}
                  value={props.preferredName}
                  style={{
                    backgroundColor: theme.palette.background.default,
                    border: "none",
                    padding: "2px 4px",
                    borderRadius: "4px",
                  }}
                  onChange={(e) => {
                    props.setPreferredName(e.target.value);
                  }}
                />
              )}
            </Stack>
            {/* <NodeBaseButton
                func={async () => {
                  const { data, error } = await supabase
                    .from("virtual_keys")
                    .update({ full_name: props.preferedName })
                    .eq("virtual_key", props.virtualKeyRowData?.virtual_key)
                    .select();
                  if (error) {
                    console.log(`Error updating name: ${error}`);
                  }
                }}
                icon={Save}
                toolTipValue={"Save"}
                color={"text.secondary"}
                bgcolor={"none"}
              /> */}
          </Stack>
        </Stack>
        <Stack padding={"16px 0px 16px 0px"} gap={"4px"}>
          <Typography variant={"body2"}>{"Virtual key"}</Typography>
          <Typography variant={"caption"} color={"text.secondary"}>
            {props.virtualKey}
          </Typography>
        </Stack>
      </Stack>

      <Stack padding={"0px 48px 0px 48px"} gap={"8px"}>
        <Typography variant="subtitle1">Account information</Typography>
        <Divider/>
        <Stack padding={"16px 0px 16px 0px"} gap={"4px"}>
          <Typography variant={"body2"}>Email</Typography>
          <Typography variant={"caption"} color={"text.secondary"}>
            {props.session?.user.email}
          </Typography>
        </Stack>
      </Stack>
    </Stack>
  );
});

const BalanceMenu = memo((props: {
  session: Session | null;
  usage: UsageResponse | null;
  subscriptionBusy: boolean;
  reloadUsage: () => Promise<void>;
  onSubscribe: () => Promise<void>;
  onCancel: () => Promise<void>;
}) => {
  const status = props.usage?.subscription_status ?? "none";
  const isActive = status === "active";
  const needsSubscribe = !isActive;

  return (
    <Stack gap={"24px"}>
      <Stack padding={"0px 48px 0px 48px"} gap={"8px"}>
        <Typography variant="subtitle1">My balance</Typography>
        <Divider/>
        <Stack
          direction={"row"}
          justifyContent={"space-between"}
          alignItems={"center"}
        >
          <Typography color={"text.primary"} variant="subtitle2">
            {props.usage ? (
              `${Number(props.usage.used).toFixed(3)}/${props.usage.limit} $`
            ) : (
              <CircularProgress size={20}/>
            )}
          </Typography>

          <SystemIconButton
            icon={Refresh}
            func={props.reloadUsage}
            toolTipValue={"Update balance value"}
          />
        </Stack>
        <Stack gap={"8px"} paddingTop={"8px"}>
          <Typography variant="body2" color="text.secondary">
            Subscription: {status}
          </Typography>
          {needsSubscribe && (
            <Button
              variant="contained"
              disabled={props.subscriptionBusy || !props.session}
              onClick={props.onSubscribe}
            >
              Subscribe — $5/month
            </Button>
          )}
          {isActive && (
            <Button
              variant="outlined"
              color="inherit"
              disabled={props.subscriptionBusy || !props.session}
              onClick={props.onCancel}
            >
              Cancel subscription
            </Button>
          )}
        </Stack>
      </Stack>
    </Stack>
  );
});

const AboutMenu = memo(() => {
  const [appVersionLabel, setAppVersionLabel] = useState("");

  useEffect(() => {
    fetch("/release-version.txt")
      .then((r) => r.text())
      .then((text) => {
        /^v\d+\.\d+\.\d+\n$/.test(text)
          ? setAppVersionLabel(text)
          : setAppVersionLabel("-");
      })
      .catch((err) => {
        console.log(err);
        setAppVersionLabel("-");
      });
  }, []);

  return (
    <Stack gap={"24px"}>
      <Stack padding={"0px 48px 0px 48px"} gap={"8px"}>
        <Typography variant="subtitle1">About</Typography>
        <Divider/>
        <Typography
          padding={"16px 0px 0px 0px"}
          variant="body2"
          color="text.primary"
        >
          Contact us:{" "}
          <Link href="mailto:welcome@getzen.dev" underline="hover" color="text.secondary">
            welcome@getzen.dev
          </Link>
        </Typography>
        <Typography
          padding={"0px 0px 16px 0px"}
          variant="body2"
          color="text.secondary"
        >{`Devneya App version: ${appVersionLabel}`}</Typography>
      </Stack>
    </Stack>
  );
});

type MenuTypes = "account" | "balance" | "about";

type AccountMenuModalProps = {
  open: boolean;
  handleOpen: () => void;
  handleClose: () => void;
  avatarPath?: string;
  setAvatarPath: React.Dispatch<React.SetStateAction<string | undefined>>
};

/**
 * AccountMenuModal component
 * Full-screen modal for managing account settings.
 */
export default function AccountMenuModal(props: AccountMenuModalProps) {
  const session = useContext(SessionContext);
  const virtualKey = useContext(VirtualKeyContext);
  const {enqueueSnackbar} = useSnackbar();

  const [activeMenu, setActiveMenu] = useState<MenuTypes>("account");
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [subscriptionBusy, setSubscriptionBusy] = useState(false);

  const [preferredName, setPreferredName] = useState<string>("");
  const [changeNameStatus, setChangeNameStatus] = useState(false);
  const [height, setHeight] = useState(window.innerHeight);
  const updateDimensions = () => {
    setHeight(window.innerHeight);
  };
  useEffect(() => {
    window.addEventListener("resize", updateDimensions);
    return () => window.removeEventListener("resize", updateDimensions);
  }, []);

  useEffect(() => {
    const loadUserName = async () => {
      const {data, error} = await supabase.auth.getUser();
      if (error !== null || data === null) {
        console.log(error);
        return;
      }

      if (
        data.user.user_metadata.name === undefined ||
        data.user.user_metadata.name === ""
      ) {
        setChangeNameStatus(true);
      } else {
        setPreferredName(data.user.user_metadata.name);
      }
    };
    loadUserName();
  }, []);

  useEffect(() => {
    const loadAvatar = async () => {
      const {data, error} = await supabase.auth.getUser();
      if (error || !data?.user) return;

      const path = data.user.user_metadata?.avatar_path;
      if (typeof path === "string") {
        props.setAvatarPath(path);
      }
    };

    loadAvatar();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const avatarUrl = useAvatar(props.avatarPath);

  const reloadUsage = useCallback(async () => {
    if (!session?.access_token || !import.meta.env.VITE_PROXY_URL) {
      return;
    }
    try {
      const data = await fetchUsage(
        import.meta.env.VITE_PROXY_URL,
        session.access_token
      );
      setUsage(data);
    } catch (err) {
      console.log(err);
      setUsage(null);
      enqueueSnackbar(String(err), {variant: "error"});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token]);

  const handleSubscribe = useCallback(async () => {
    if (!session?.access_token || !import.meta.env.VITE_PROXY_URL) {
      return;
    }
    setSubscriptionBusy(true);
    try {
      const data = await startSubscription(
        import.meta.env.VITE_PROXY_URL,
        session.access_token
      );
      if (data.status === "checkout" && data.checkout_url) {
        window.location.href = data.checkout_url;
        return;
      }
      enqueueSnackbar("Subscription active", {variant: "success"});
      await reloadUsage();
    } catch (err) {
      enqueueSnackbar(String(err), {variant: "error"});
    } finally {
      setSubscriptionBusy(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token, reloadUsage]);

  const handleCancel = useCallback(async () => {
    if (!session?.access_token || !import.meta.env.VITE_PROXY_URL) {
      return;
    }
    setSubscriptionBusy(true);
    try {
      const data = await cancelSubscription(
        import.meta.env.VITE_PROXY_URL,
        session.access_token
      );
      const msg = data.access_until
        ? `Cancelled — access until ${data.access_until}`
        : "Subscription cancelled";
      enqueueSnackbar(msg, {variant: "info"});
      await reloadUsage();
    } catch (err) {
      enqueueSnackbar(String(err), {variant: "error"});
    } finally {
      setSubscriptionBusy(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token, reloadUsage]);

  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);

  const handleLogOutButtonClick = (
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    setAnchorEl(anchorEl ? null : event.currentTarget);
  };

  const logoutFlowPopoverOpened = Boolean(anchorEl);

  const menuVariants = useMemo(
    () => ({
      account: (
        <AccountMenu
          session={session}
          virtualKey={virtualKey}
          firstLetters={getFirstLetters(session?.user.email ?? "")}
          preferredName={preferredName}
          setPreferredName={setPreferredName}
          changeNameStatus={changeNameStatus}
          setChangeNameStatus={setChangeNameStatus}
          avatarPath={props.avatarPath}
          setAvatarPath={props.setAvatarPath}
        />
      ),
      balance: (
        <BalanceMenu
          session={session}
          usage={usage}
          subscriptionBusy={subscriptionBusy}
          reloadUsage={reloadUsage}
          onSubscribe={handleSubscribe}
          onCancel={handleCancel}
        />
      ),
      about: <AboutMenu/>,
    }),
    [session, virtualKey, preferredName, changeNameStatus, usage, subscriptionBusy, reloadUsage, handleSubscribe, handleCancel, props.avatarPath, props.setAvatarPath]
  );

  return (
    <Modal
      open={props.open}
      onClose={() => {
        props.handleClose();
        setActiveMenu("account");
      }}
      sx={{display: "flex", alignItems: "center", justifyContent: "center"}}
    >
      <Box
        width={"100%"}
        maxWidth={"1000px"}
        // height="440px"
        height={Math.min(Math.max(height - 89, 0), 440)}
        bgcolor="background.paper"
        borderRadius={"16px"}
        overflow="hidden"
      >
        <Stack direction="row" height={"100%"}>
          <Stack
            direction="column"
            width={"100%"}
            height={"100%"}
            maxWidth={"238px"}
            padding={"24px 8px 24px 16px"}
            bgcolor={"background.default"}
          >
            <Stack direction={"row"} alignItems={"center"} gap={"8px"}>
              <Avatar
                src={avatarUrl ?? undefined}
                sx={{
                  width: "24px",
                  height: "24px",
                  bgcolor: "primary.main",
                  ...theme.typography.body2,
                }}
              >
                {!avatarUrl && getFirstLetters(session?.user.email ?? "")}
              </Avatar>
              <Box>
                <Typography
                  variant={"subtitle1"}
                  width={"154px"}
                  whiteSpace={"nowrap"}
                  textOverflow="ellipsis"
                  overflow="hidden"
                >
                  {preferredName}
                </Typography>
                <Typography
                  variant={"caption"}
                  color={"text.secondary"}
                  lineHeight="24px"
                >
                  {session?.user.email}
                </Typography>
              </Box>
            </Stack>
            <MenuList>
              <MenuItem
                onClick={() => setActiveMenu("account")}
                sx={{
                  borderRadius: "4px",
                  bgcolor: activeMenu === "account" ? "primary.light" : "none",
                  "&:hover": {
                    bgcolor: "primary.light",
                  },
                }}
              >
                <ListItemIcon>
                  <PersonOutline
                    fontSize="small"
                    sx={{
                      color: activeMenu === "account" ? "text.primary" : "",
                    }}
                  />
                </ListItemIcon>
                <Typography
                  variant="subtitle2"
                  color="text.secondary"
                  sx={{
                    fontWeight: activeMenu === "account" ? "bold" : "normal",
                    color: "black",
                  }}
                >
                  My account
                </Typography>
              </MenuItem>
              <MenuItem
                onClick={() => {
                  reloadUsage();
                  setActiveMenu("balance");
                }}
                sx={{
                  borderRadius: "4px",
                  bgcolor: activeMenu === "balance" ? "primary.light" : "none",
                  "&:hover": {
                    bgcolor: "primary.light",
                  },
                }}
              >
                <ListItemIcon>
                  <AttachMoney
                    fontSize="small"
                    sx={{
                      color: activeMenu === "balance" ? "text.primary" : "",
                    }}
                  />
                </ListItemIcon>
                <Typography
                  variant="subtitle2"
                  color="text.secondary"
                  sx={{
                    fontWeight: activeMenu === "balance" ? "bold" : "normal",
                    color: "black",
                  }}
                >
                  My balance
                </Typography>
              </MenuItem>
              <MenuItem
                onClick={() => setActiveMenu("about")}
                sx={{
                  borderRadius: "4px",
                  bgcolor: activeMenu === "about" ? "primary.light" : "none",
                  "&:hover": {
                    bgcolor: "primary.light",
                  },
                }}
              >
                <ListItemIcon>
                  <HelpOutline
                    fontSize="small"
                    sx={{color: activeMenu === "about" ? "text.primary" : ""}}
                  />
                </ListItemIcon>
                <Typography
                  variant="subtitle2"
                  color="text.secondary"
                  sx={{
                    fontWeight: activeMenu === "about" ? "bold" : "normal",
                    color: "black",
                  }}
                >
                  About
                </Typography>
              </MenuItem>
              <Button
                onClick={handleLogOutButtonClick}
                sx={{
                  borderRadius: "4px",
                  marginTop: "16px",
                  textTransform: "none",
                  marginLeft: "8px",
                  width: "200px",
                  justifyContent: "flex-start",
                }}
              >
                <ListItemIcon sx={{color: "error.dark"}}>
                  <Logout fontSize="small"/>
                </ListItemIcon>
                <Typography
                  variant="subtitle2"
                  color="error.dark"
                  sx={{marginLeft: "-20px"}}
                >
                  Log out
                </Typography>
              </Button>
            </MenuList>
          </Stack>
          <DeletePopover
            actionCallback={async () => {
              await supabase.auth.signOut();
            }}
            open={logoutFlowPopoverOpened}
            anchorEl={anchorEl}
            setAnchorEl={setAnchorEl}
            centered={true}
            label={"Confirm logout?"}
          />
          <Stack
            direction={"column"}
            width={"100%"}
            overflow="hidden"
            display="flex"
            flexDirection="column"
          >
            <Stack
              direction={"row"}
              width={"100%"}
              padding={"16px"}
              justifyContent={"end"}
            >
              <IconButton
                sx={{width: "32px", height: "32px"}}
                onClick={() => {
                  props.handleClose();
                  setActiveMenu("account");
                }}
              >
                <Close/>
              </IconButton>
            </Stack>
            <Box sx={{overflow: "auto"}}>
              {menuVariants[activeMenu]}
            </Box>
          </Stack>
        </Stack>
      </Box>
    </Modal>
  );
}
