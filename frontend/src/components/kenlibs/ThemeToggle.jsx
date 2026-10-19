import { Moon, Sun } from "lucide-react";
import useTheme from "../../hooks/useTheme";

// Quick dark-mode switch in the Kenlibs nav and mobile menu. Toggles
// between explicit Light and Dark (the Profile page also offers System).
// A real <button> with aria-pressed, so screen readers announce
// "Dark theme, toggle button, pressed / not pressed".
const ThemeToggle = ({ className = "", showLabel = false }) => {
  const { theme, setPreference } = useTheme();
  const isDark = theme === "dark";
  const Icon = isDark ? Sun : Moon;
  return (
    <button
      type="button"
      aria-pressed={isDark}
      aria-label="Dark theme"
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => setPreference(isDark ? "light" : "dark")}
      className={`inline-flex items-center gap-2 min-w-[44px] min-h-[44px] justify-center rounded-xl text-white/80 hover:text-white hover:bg-white/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80 ${className}`}
    >
      <Icon className="w-[18px] h-[18px]" aria-hidden="true" />
      {showLabel && <span className="text-sm font-medium">{isDark ? "Light theme" : "Dark theme"}</span>}
    </button>
  );
};

export default ThemeToggle;
