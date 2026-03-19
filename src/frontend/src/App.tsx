import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Toaster } from "@/components/ui/sonner";
import { AlertTriangle, Camera, Settings, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { useState as useNameState } from "react";
import LoginButton from "./components/LoginButton";
import { CameraSettingsProvider } from "./contexts/CameraSettingsContext";
import { useInternetIdentity } from "./hooks/useInternetIdentity";
import {
  useGetCallerUserProfile,
  useSaveCallerUserProfile,
} from "./hooks/useQueries";
import CaptureTab from "./pages/CaptureTab";
import SettingsTab from "./pages/SettingsTab";

type TabId = "capture" | "settings";

function ProfileSetup() {
  const { identity } = useInternetIdentity();
  const { data: profile, isLoading, isFetched } = useGetCallerUserProfile();
  const { mutateAsync: saveProfile, isPending } = useSaveCallerUserProfile();
  const [name, setName] = useNameState("");
  const isAuthenticated = !!identity;
  const showSetup =
    isAuthenticated && isFetched && !isLoading && profile === null;

  if (!showSetup) return null;

  return (
    <Dialog open={showSetup} data-ocid="profile_setup.dialog">
      <DialogContent className="bg-popover border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground">
            Welcome to CHRONO CAM
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Enter your display name to get started.
        </p>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name…"
          className="bg-input border-border"
          onKeyDown={(e) =>
            e.key === "Enter" &&
            name.trim() &&
            saveProfile({ name: name.trim() })
          }
          data-ocid="profile_setup.input"
        />
        <DialogFooter>
          <Button
            onClick={() => saveProfile({ name: name.trim() || "Anonymous" })}
            disabled={isPending}
            className="bg-accent text-accent-foreground hover:bg-accent/90"
            data-ocid="profile_setup.confirm_button"
          >
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>("capture");
  const [permissionBanner, setPermissionBanner] = useState<string | null>(null);

  useEffect(() => {
    // Check camera permission proactively
    navigator.permissions
      ?.query({ name: "camera" as PermissionName })
      .then((status) => {
        if (status.state === "denied") {
          setPermissionBanner(
            "Camera access is blocked. Please allow camera permission in your browser settings.",
          );
        }
        status.onchange = () => {
          if (status.state === "denied") {
            setPermissionBanner(
              "Camera access is blocked. Please allow camera permission in your browser settings.",
            );
          } else {
            setPermissionBanner(null);
          }
        };
      })
      .catch(() => {});
  }, []);

  return (
    <CameraSettingsProvider>
      <div className="min-h-screen bg-background flex flex-col">
        {/* Header */}
        <header
          className="sticky top-0 z-50 border-b border-border"
          style={{ background: "oklch(0.172 0.015 244)" }}
        >
          <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-4">
            {/* Logo */}
            <div className="flex items-center gap-2 shrink-0">
              <div className="h-7 w-7 rounded-md bg-accent/20 flex items-center justify-center">
                <Camera className="h-4 w-4 text-accent" />
              </div>
              <span className="font-bold text-sm tracking-widest text-foreground uppercase">
                Chrono Cam
              </span>
              <span className="hidden sm:block text-border mx-1">|</span>
              <span className="hidden sm:block text-xs text-muted-foreground">
                Timelapse Capture
              </span>
            </div>

            {/* Nav tabs */}
            <nav className="flex items-center gap-1 ml-4">
              <button
                type="button"
                onClick={() => setActiveTab("capture")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  activeTab === "capture"
                    ? "bg-accent/15 text-accent border border-accent/30"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                }`}
                data-ocid="nav.capture.link"
              >
                <Camera className="h-3.5 w-3.5" />
                Capture
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("settings")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  activeTab === "settings"
                    ? "bg-accent/15 text-accent border border-accent/30"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                }`}
                data-ocid="nav.settings.link"
              >
                <Settings className="h-3.5 w-3.5" />
                Settings
              </button>
            </nav>

            {/* Auth */}
            <div className="ml-auto">
              <LoginButton />
            </div>
          </div>
        </header>

        {/* Permission banner */}
        <AnimatePresence>
          {permissionBanner && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="bg-destructive/10 border-b border-destructive/30"
              data-ocid="permission.error_state"
            >
              <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2 flex items-center gap-3">
                <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                <p className="text-xs text-destructive flex-1">
                  {permissionBanner}
                </p>
                <button
                  type="button"
                  onClick={() => setPermissionBanner(null)}
                  className="text-destructive hover:text-destructive/70"
                  data-ocid="permission.close_button"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main content */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">
          <AnimatePresence mode="wait">
            {activeTab === "capture" ? (
              <motion.div
                key="capture"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
              >
                <CaptureTab />
              </motion.div>
            ) : (
              <motion.div
                key="settings"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
              >
                <SettingsTab />
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        {/* Footer */}
        <footer className="border-t border-border py-4 px-4 sm:px-6">
          <div className="max-w-7xl mx-auto flex items-center justify-center">
            <p className="text-xs text-muted-foreground">
              © {new Date().getFullYear()}. Built with ❤️ using{" "}
              <a
                href={`https://caffeine.ai?utm_source=caffeine-footer&utm_medium=referral&utm_content=${encodeURIComponent(typeof window !== "undefined" ? window.location.hostname : "")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                caffeine.ai
              </a>
            </p>
          </div>
        </footer>

        <Toaster theme="dark" position="bottom-right" />
        <ProfileSetup />
      </div>
    </CameraSettingsProvider>
  );
}
