import { ArrowRight, Sparkles, BookOpen, Zap } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { Link } from "react-router-dom";
import HERO_IMAGE from "../../assets/hero_img.jpg";

const Hero = () => {
  const { isAuthenticated } = useAuth();

  return (
    <div className="relative overflow-hidden bg-gradient-to-br from-gray-50 via-white to-violet-50 pt-20 pb-16 lg:pt-28 lg:pb-24">
      
      {/* Floating Background Elements */}
      <div className="absolute top-10 left-10 w-72 h-72 bg-violet-300/20 rounded-full blur-3xl animate-pulse-slow"></div>
      <div className="absolute bottom-20 right-12 w-96 h-96 bg-purple-300/20 rounded-full blur-3xl animate-pulse-slow delay-1000"></div>
      <div className="absolute top-1/3 right-1/4 w-40 h-40 bg-pink-200/20 rounded-full blur-3xl animate-pulse-slow delay-2000"></div>
      
      <div className="absolute -top-12 -left-12 w-52 h-52 bg-violet-400/10 rounded-3xl rotate-12 blur-2xl"></div>
      <div className="absolute -bottom-16 -right-20 w-64 h-64 bg-purple-400/10 rounded-full blur-3xl"></div>

      <div className="max-w-7xl mx-auto px-6 lg:px-8 relative z-10">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          
          {/* Left Content */}
          <div className="space-y-8">
            <div className="inline-flex items-center gap-2 bg-white rounded-2xl px-4 py-2 shadow-sm border border-violet-100">
              <Sparkles className="w-5 h-5 text-violet-600" />
              <span className="text-sm font-semibold text-violet-700 tracking-wide">
                AI-POWERED BOOK PUBLISHING
              </span>
            </div>

            <h1 className="text-5xl lg:text-6xl xl:text-7xl font-bold text-gray-900 leading-tight tracking-tighter">
              Create Stunning{" "}
              <span className="bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">
                Digital Books
              </span>{" "}
              With Ease
            </h1>

            <p className="text-xl text-gray-600 max-w-lg leading-relaxed">
              Unleash your creativity and publish professional digital books 
              effortlessly with our AI-powered platform. Turn your ideas into 
              captivating stories in minutes.
            </p>

            <div className="flex flex-wrap gap-4">
              <Link
                to={isAuthenticated ? "/dashboard" : "/login"}
                className="group inline-flex items-center gap-3 bg-gradient-to-r from-violet-600 to-purple-600 text-white px-8 py-4 rounded-2xl font-semibold text-lg shadow-xl shadow-violet-500/30 hover:shadow-2xl hover:scale-105 transition-all duration-300"
              >
                Get Started For Free
                <ArrowRight className="w-6 h-6 group-hover:translate-x-1 transition-transform" />
              </Link>

              <a
                href="#demo"
                className="inline-flex items-center gap-3 border border-gray-300 hover:border-gray-400 px-8 py-4 rounded-2xl font-semibold text-lg text-gray-700 hover:bg-gray-50 transition-all"
              >
                Watch Demo
                <ArrowRight className="w-6 h-6" />
              </a>
            </div>

            <div className="flex flex-wrap gap-8 pt-6">
              <div>
                <div className="text-4xl font-bold text-gray-900">50k+</div>
                <div className="text-gray-500">Books Published</div>
              </div>
              <div>
                <div className="text-4xl font-bold text-gray-900">4.9/5</div>
                <div className="text-gray-500">User Rating</div>
              </div>
              <div>
                <div className="text-4xl font-bold text-gray-900">10 min</div>
                <div className="text-gray-500">Avg. Creation Time</div>
              </div>
            </div>
          </div>

          {/* Right Side - Visual */}
          <div className="relative flex justify-center">
            <div className="relative">
              <div className="relative bg-white rounded-3xl shadow-2xl shadow-violet-500/20 overflow-hidden border border-gray-100">
                <img
                  src={HERO_IMAGE}
                  alt="AI Ebook Creation Dashboard"
                  className="w-full h-auto rounded-3xl"
                />

                {/* Glassmorphic Processing Card */}
                <div className="absolute -top-6 -right-6 bg-white/70 backdrop-blur-xl border border-white/60 rounded-3xl shadow-2xl p-6 max-w-[270px] hover:bg-white/90 transition-all duration-500 hover:scale-[1.03] hover:shadow-violet-500/30 group">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center flex-shrink-0 shadow-lg animate-pulse-slow">
                      <Zap className="w-7 h-7 text-white" />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-emerald-500 rounded-full animate-ping"></div>
                        <span className="uppercase text-xs font-semibold tracking-[2px] text-amber-600">AI is Working</span>
                      </div>
                      <div className="font-semibold text-lg leading-tight text-gray-900">Generating your masterpiece...</div>
                      <p className="text-sm text-gray-600 leading-snug">
                        Our AI is crafting rich content, chapters, and beautiful formatting in real-time.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Glassmorphic Completed Card */}
                <div className="absolute -bottom-6 -left-6 bg-white/80 backdrop-blur-xl border border-white/60 rounded-3xl shadow-2xl p-6 max-w-[250px] hover:bg-white/95 transition-all duration-500 hover:scale-[1.03] hover:shadow-emerald-500/30 group">
                  <div className="flex items-center gap-5">
                    <div className="w-14 h-14 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl flex items-center justify-center shadow-inner">
                      <BookOpen className="w-8 h-8 text-white" />
                    </div>
                    <div>
                      <div className="uppercase text-emerald-600 text-xs font-semibold tracking-widest">Completed</div>
                      <div className="text-5xl font-bold text-gray-900 leading-none mt-1">247</div>
                      <div className="text-gray-500 text-lg -mt-1">pages</div>
                      <div className="mt-4 inline-flex items-center gap-2 bg-emerald-50 text-emerald-700 text-xs font-medium px-3 py-1.5 rounded-full">
                        ✓ Ready for Download & Publish
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Main Glow Layer */}
              <div className="absolute inset-0 bg-gradient-to-br from-violet-400/20 via-purple-400/20 to-transparent -z-10 blur-3xl rounded-[4rem]"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Hero;