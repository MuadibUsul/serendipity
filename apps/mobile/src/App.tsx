import type { ColorScheme } from "@serendipity/ui";
import { useCallback, useEffect, useReducer, useState } from "react";
import { Linking, View } from "react-native";
import { SafeAreaProvider, initialWindowMetrics } from "react-native-safe-area-context";
import type { Metrics } from "react-native-safe-area-context";

import type { Api, Home, Me } from "./api/types";
import { COMMON } from "./copy";
import type { NotificationPermissions, NotificationStatus } from "./platform/notifications";
import { AiScreen } from "./screens/AiScreen";
import { DatesScreen } from "./screens/DatesScreen";
import { MeScreen } from "./screens/MeScreen";
import { NotificationPrimerScreen } from "./screens/NotificationPrimerScreen";
import { RelationshipsScreen } from "./screens/RelationshipsScreen";
import { SignInScreen } from "./screens/SignInScreen";
import { INITIAL, reduce } from "./shell/state";
import type { Session, Tab } from "./shell/state";
import { AppText } from "./ui/AppText";
import { Button } from "./ui/Button";
import { Screen } from "./ui/Screen";
import { PageSkeleton } from "./ui/Skeleton";
import { TabBar } from "./ui/TabBar";
import { ThemeProvider, usePalette } from "./ui/theme";

export interface AppProps {
  readonly api: Api;
  readonly notifications: NotificationPermissions;
  /** Fixed colour scheme (tests, previews); the system's otherwise. */
  readonly scheme?: ColorScheme;
  /** Safe-area metrics to start with (tests); measured on a device. */
  readonly safeAreaMetrics?: Metrics | null;
  /** The clock (tests fix it); the device's otherwise. */
  readonly now?: () => Date;
}

const deviceClock = () => new Date();

export function App({
  api,
  notifications,
  scheme,
  safeAreaMetrics = initialWindowMetrics,
  now = deviceClock,
}: AppProps) {
  return (
    <SafeAreaProvider initialMetrics={safeAreaMetrics}>
      <ThemeProvider {...(scheme === undefined ? {} : { scheme })}>
        <Shell api={api} notifications={notifications} now={now} />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function Shell({
  api,
  notifications,
  now,
}: {
  readonly api: Api;
  readonly notifications: NotificationPermissions;
  readonly now: () => Date;
}) {
  const [state, dispatch] = useReducer(reduce, INITIAL);
  const [notificationStatus, setNotificationStatus] = useState<NotificationStatus>("unavailable");

  const signedIn = useCallback(
    async (session: Session) => {
      const status = await notifications.status();
      setNotificationStatus(status);
      dispatch({ type: "signed_in", session, notifications: status });
    },
    [notifications],
  );

  switch (state.phase) {
    case "signed_out":
      return <SignInScreen api={api} onSignedIn={(session) => void signedIn(session)} />;
    case "notification_primer":
      return (
        <NotificationPrimerScreen
          notifications={notifications}
          onDecided={(status) => {
            setNotificationStatus(status);
            dispatch({ type: "notifications_decided" });
          }}
        />
      );
    case "main":
      return (
        <Main
          api={api}
          now={now}
          session={state.session}
          tab={state.tab}
          onTab={(tab) => {
            dispatch({ type: "tab_selected", tab });
          }}
          notificationStatus={notificationStatus}
          onEnableNotifications={() => void notifications.request().then(setNotificationStatus)}
          onSignOut={() => {
            dispatch({ type: "signed_out" });
          }}
        />
      );
    default:
      return assertNever(state);
  }
}

type Load =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly home: Home };

function useHome(api: Api, session: Session) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    api.home(session).then(
      (home) => {
        if (live) setLoad({ kind: "ready", home });
      },
      () => {
        if (live) setLoad({ kind: "failed" });
      },
    );
    return () => {
      live = false;
    };
  }, [api, session, attempt]);
  const retry = useCallback(() => {
    setLoad({ kind: "loading" });
    setAttempt((n) => n + 1);
  }, []);
  const setMe = useCallback((me: Me) => {
    setLoad((current) =>
      current.kind === "ready" ? { kind: "ready", home: { ...current.home, me } } : current,
    );
  }, []);
  return { load, retry, setMe };
}

function Main({
  api,
  now,
  session,
  tab,
  onTab,
  notificationStatus,
  onEnableNotifications,
  onSignOut,
}: {
  readonly api: Api;
  readonly now: () => Date;
  readonly session: Session;
  readonly tab: Tab;
  readonly onTab: (tab: Tab) => void;
  readonly notificationStatus: NotificationStatus;
  readonly onEnableNotifications: () => void;
  readonly onSignOut: () => void;
}) {
  const palette = usePalette();
  const { load, retry, setMe } = useHome(api, session);
  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <View style={{ flex: 1 }}>
        {load.kind === "loading" ? (
          <Screen>
            <View aria-busy style={{ gap: 28 }}>
              <AppText variant="footnote" color="textSecondary" live="polite" heading>
                {COMMON.loading}
              </AppText>
              <PageSkeleton />
            </View>
          </Screen>
        ) : load.kind === "failed" ? (
          <Screen>
            <AppText color="danger" live="assertive" heading>
              {COMMON.loadFailed}
            </AppText>
            <Button label={COMMON.retry} onPress={retry} />
          </Screen>
        ) : (
          <Page
            tab={tab}
            home={load.home}
            now={now()}
            notificationStatus={notificationStatus}
            onEnableNotifications={onEnableNotifications}
            onPauseChange={(paused) => void api.setMatchingPaused(session, paused).then(setMe)}
            onSignOut={onSignOut}
          />
        )}
      </View>
      <TabBar current={tab} onSelect={onTab} />
    </View>
  );
}

function Page({
  tab,
  home,
  now,
  notificationStatus,
  onEnableNotifications,
  onPauseChange,
  onSignOut,
}: {
  readonly tab: Tab;
  readonly home: Home;
  readonly now: Date;
  readonly notificationStatus: NotificationStatus;
  readonly onEnableNotifications: () => void;
  readonly onPauseChange: (paused: boolean) => void;
  readonly onSignOut: () => void;
}) {
  switch (tab) {
    case "ai":
      return <AiScreen home={home} />;
    case "dates":
      return <DatesScreen home={home} now={now} />;
    case "relationships":
      return <RelationshipsScreen home={home} />;
    case "me":
      return (
        <MeScreen
          me={home.me}
          notificationStatus={notificationStatus}
          onEnableNotifications={onEnableNotifications}
          onOpenSettings={() => void Linking.openSettings().catch(() => undefined)}
          onPauseChange={onPauseChange}
          onSignOut={onSignOut}
        />
      );
    default:
      return assertNever(tab);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${JSON.stringify(value)}`);
}
