import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Wallet, Landmark, User, Hash, StickyNote } from "lucide-react";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
import getErrorMessage from "../utils/getErrorMessage";
import DashboardLayout from "../components/layout/DashboardLayout";
import InputField from "../components/ui/inputField";
import Button from "../components/ui/Button";

const EMPTY_DETAILS = {
  bankName: "",
  accountNumber: "",
  accountHolderName: "",
  notes: "",
};

const AdminPaymentSettingsPage = () => {
  const [details, setDetails] = useState(EMPTY_DETAILS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const fetchDetails = async () => {
      try {
        const res = await axiosInstance.get(API_PATHS.ADMIN.PAYMENT_DETAILS);
        setDetails({ ...EMPTY_DETAILS, ...res.data });
      } catch (error) {
        toast.error(getErrorMessage(error, "Failed to load payment details"));
      } finally {
        setIsLoading(false);
      }
    };
    fetchDetails();
  }, []);

  const handleChange = (e) => {
    setDetails((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const res = await axiosInstance.put(API_PATHS.ADMIN.PAYMENT_DETAILS, details);
      setDetails({ ...EMPTY_DETAILS, ...res.data });
      toast.success("Payment details updated");
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to save payment details"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Wallet className="w-6 h-6 text-accent" />
            Payment Settings
          </h1>
          <p className="text-gray-500 mt-1">
            The bank details readers see at checkout, and your own reference for sending
            refunds. Only the bank name, account number, and account holder name are ever
            shown to readers — notes stay private to you.
          </p>
        </div>

        {isLoading ? (
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-8 animate-pulse space-y-5">
            <div className="h-12 bg-gray-100 rounded-2xl" />
            <div className="h-12 bg-gray-100 rounded-2xl" />
            <div className="h-12 bg-gray-100 rounded-2xl" />
            <div className="h-20 bg-gray-100 rounded-2xl" />
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="bg-white rounded-3xl border border-gray-100 shadow-sm p-8 space-y-6"
          >
            <InputField
              label="Bank Name"
              name="bankName"
              value={details.bankName}
              onChange={handleChange}
              icon={Landmark}
              placeholder="e.g. Guaranty Trust Bank"
            />
            <InputField
              label="Account Number"
              name="accountNumber"
              value={details.accountNumber}
              onChange={handleChange}
              icon={Hash}
              placeholder="e.g. 0123456789"
            />
            <InputField
              label="Account Holder Name"
              name="accountHolderName"
              value={details.accountHolderName}
              onChange={handleChange}
              icon={User}
              placeholder="Name exactly as it appears on the account"
            />

            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <StickyNote className="w-4 h-4 text-gray-400" />
                Notes (private — never shown to readers)
              </label>
              <textarea
                name="notes"
                value={details.notes}
                onChange={handleChange}
                placeholder="e.g. refund reference format, alternate accounts, reminders for yourself"
                rows={3}
                className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3.5 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500 transition-all duration-200 resize-none"
              />
            </div>

            <div className="pt-2">
              <Button type="submit" loading={isSaving}>
                Save Payment Details
              </Button>
            </div>
          </form>
        )}
      </div>
    </DashboardLayout>
  );
};

export default AdminPaymentSettingsPage;
