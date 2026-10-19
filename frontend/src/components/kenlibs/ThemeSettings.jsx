import { Monitor, Moon, Sun } from "lucide-react";
import useTheme from "../../hooks/useTheme";

// "Appearance" on the reader profile: Light / Dark / System as a radio
// group (arrow keys move between options, as native radios do). System
// follows the device setting and changes with it live.
const OPTIONS = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
];

const ThemeSettings = () => {
  const { preference, theme, setPreference } = useTheme();
  return (
    <section aria-labelledby="appearance-heading" className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6">
      <h2 id="appearance-heading" className="font-semibold text-gray-900">
        Appearance
      </h2>
      <p className="text-sm text-gray-600 mt-0.5">
        {preference === "system" ? `Following your device (now ${theme}).` : `Always ${preference}.`}
      </p>
      <fieldset className="mt-4">
        <legend className="sr-only">Theme</legend>
        <div className="grid grid-cols-3 gap-2">
          {OPTIONS.map(({ value, label, Icon }) => (
            <label
              key={value}
              className={`relative flex flex-col items-center justify-center gap-1.5 min-h-[72px] rounded-2xl border-2 cursor-pointer transition-colors focus-within:ring-2 focus-within:ring-accent focus-within:ring-offset-2 focus-within:ring-offset-surface ${
                preference === value ? "border-accent bg-accent-50 text-gray-900" : "border-gray-200 text-gray-700 hover:border-gray-300"
              }`}
            >
              <input
                type="radio"
                name="kenlibs-theme"
                value={value}
                checked={preference === value}
                onChange={() => setPreference(value)}
                className="sr-only"
              />
              <Icon className="w-5 h-5" aria-hidden="true" />
              <span className="text-sm font-semibold">{label}</span>
            </label>
          ))}
        </div>
      </fieldset>
    </section>
  );
};

export default ThemeSettings;
