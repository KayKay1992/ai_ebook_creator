import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import { User, Mail, Sparkles } from 'lucide-react'
import DashboardLayout from '../components/layout/DashboardLayout'
import InputField from '../components/ui/inputField'
import Button from '../components/ui/Button'
import { useAuth } from '../context/AuthContext'
import axiosInstance from '../utils/axiosInstance'
import { API_PATHS } from '../utils/apiPaths'

const ProfilePage = () => {
  const { user, updateUser, loading: authLoading } = useAuth()
  const [formData, setFormData] = useState({
    name: '',
    email: '',
  })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (user) {
      setFormData({
        name: user.name || '',
        email: user.email || '',
      })
    }
  }, [user])

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      const response = await axiosInstance.put(API_PATHS.AUTH.UPDATE_PROFILE, {
        name: formData.name,
      })
      toast.success('Profile updated successfully')
      updateUser(response.data)
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to update profile')
    } finally {
      setLoading(false)
    }
  }

  const initials = (formData.name || user?.name || '?')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase())
    .join('')

  if (authLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <div className="flex items-center gap-3 text-accent-hover">
            <span className="h-5 w-5 border-2 border-accent-300 border-t-accent rounded-full animate-spin" />
            <span className="text-sm font-medium tracking-wide">Loading profile…</span>
          </div>
        </div>
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout activePage="profile">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-widest text-accent uppercase mb-2">
            <Sparkles className="w-3.5 h-3.5" />
            Account
          </div>
          <h2 className="text-3xl font-bold text-gray-900 tracking-tight">Profile</h2>
          <p className="text-gray-500 mt-1.5">Manage your profile information and how it appears across your account.</p>
        </div>

        {/* Card */}
        <div className="relative rounded-3xl bg-white shadow-[0_8px_30px_rgb(124,58,237,0.08)] border border-accent-100 overflow-hidden">
          {/* Gradient top accent */}
          <div className="h-1.5 w-full bg-gradient-to-r from-accent-500 via-accent-secondary-500 to-accent" />

          <div className="p-8 sm:p-10">
            {/* Avatar row */}
            <div className="flex items-center gap-4 mb-8 pb-8 border-b border-accent-100">
              <div className="relative">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent-500 to-accent-secondary flex items-center justify-center text-white font-semibold text-xl shadow-lg shadow-accent-200">
                  {initials}
                </div>
                <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-white flex items-center justify-center shadow ring-1 ring-accent-100">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                </div>
              </div>
              <div>
                <p className="text-gray-900 font-semibold text-lg">{formData.name || 'Your name'}</p>
                <p className="text-gray-400 text-sm">{formData.email}</p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5 max-w-md">
              <InputField
                label="Full Name"
                name="name"
                value={formData.name}
                onChange={handleChange}
                icon={User}
                type="text"
                required
                className="focus:ring-accent-500 focus:border-accent-500"
              />
              <InputField
                label="Email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                icon={Mail}
                type="email"
                disabled
                className="bg-accent-50/50"
              />

              <div className="pt-2">
                <Button
                  type="submit"
                  loading={loading}
                  className="bg-gradient-to-r from-accent to-accent-secondary hover:from-accent-hover hover:to-accent-secondary-hover text-white shadow-lg shadow-accent-200 rounded-xl px-6 py-2.5 font-medium transition-all duration-200 hover:shadow-accent-300 hover:-translate-y-0.5"
                >
                  Update Profile
                </Button>
              </div>
            </form>
          </div>
        </div>

        <p className="text-xs text-gray-400 mt-4 text-center">
          Changes to your name are reflected instantly across your workspace.
        </p>
      </div>
    </DashboardLayout>
  )
}

export default ProfilePage