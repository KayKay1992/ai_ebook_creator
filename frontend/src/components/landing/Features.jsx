import React from "react";
import { ArrowRight } from "lucide-react";
import { FEATURES } from "../../utils/data";

const Features = () => {
  return (
    <div id="features" className="relative py-24 lg:py-32 bg-white overflow-hidden">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        
        {/* Header */}
        <div className="text-center mb-20 max-w-3xl mx-auto space-y-6">
          <div className="inline-flex items-center gap-2 bg-white border border-violet-100 rounded-full px-5 py-2 shadow-sm">
            <span className="w-2 h-2 bg-violet-500 rounded-full animate-pulse"></span>
            <span className="text-sm font-semibold text-violet-700 tracking-widest">POWERFUL FEATURES</span>
          </div>

          <h2 className="text-4xl lg:text-5xl xl:text-6xl font-bold text-gray-900 tracking-tighter leading-tight">
            Everything you need to{" "}
            <span className="bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">
              Create Your Ebook
            </span>
          </h2>

          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Our intelligent platform combines powerful AI tools with beautiful design 
            to make professional ebook creation fast, simple, and enjoyable.
          </p>
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {FEATURES.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <div
                key={index}
                className="group bg-white border border-gray-100 hover:border-violet-200 rounded-3xl p-8 transition-all duration-500 hover:shadow-xl hover:-translate-y-2"
              >
                <div className="mb-8">
                  <div className={`w-16 h-16 bg-gradient-to-br ${feature.gradient} rounded-2xl flex items-center justify-center shadow-lg shadow-violet-500/20 group-hover:scale-110 transition-transform duration-500`}>
                    <Icon className="w-9 h-9 text-white" />
                  </div>
                </div>

                <h3 className="text-2xl font-semibold text-gray-900 mb-4 tracking-tight">
                  {feature.title}
                </h3>

                <p className="text-gray-600 leading-relaxed text-[17px]">
                  {feature.description}
                </p>

                <div className="mt-8 flex items-center gap-2 text-violet-600 font-medium group-hover:gap-3 transition-all">
                  Learn More
                  <svg 
                    xmlns="http://www.w3.org/2000/svg" 
                    className="w-5 h-5 transition-transform group-hover:translate-x-1" 
                    fill="none" 
                    viewBox="0 0 24 24" 
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            );
          })}
        </div>

        {/* Bottom CTA */}
        <div className="mt-20 text-center">
          <div className="inline-flex flex-col items-center">
            <p className="text-gray-600 mb-4 text-lg">Ready to bring your story to life?</p>
            <a
              href="/signup"
              className="group inline-flex items-center gap-3 bg-gradient-to-r from-violet-600 to-purple-600 text-white px-10 py-4 rounded-2xl font-semibold text-lg shadow-xl shadow-violet-500/30 hover:shadow-2xl hover:scale-105 transition-all duration-300"
            >
              Start Creating Today
              <ArrowRight className="w-6 h-6 group-hover:translate-x-1 transition-transform" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Features;