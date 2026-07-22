import React from "react";
import { BookOpen, Twitter, Linkedin, Heart } from "lucide-react";

const Footer = () => {
  return (
    <footer className="bg-gray-950 text-gray-400 pt-20 pb-12 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-t from-violet-600/10 via-transparent to-transparent pointer-events-none" />

      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        <div className="grid lg:grid-cols-12 gap-12">
          
          {/* Brand Column */}
          <div className="lg:col-span-5">
            <a href="/" className="flex items-center gap-3 mb-6 group">
              <div className="w-11 h-11 bg-gradient-to-br from-violet-500 to-purple-600 rounded-2xl flex items-center justify-center">
                <BookOpen className="w-6 h-6 text-white" />
              </div>
              <span className="text-2xl font-bold text-white tracking-tight">AI Book Creator</span>
            </a>

            <p className="text-lg text-gray-400 max-w-md leading-relaxed">
              Empowering creators to turn their ideas into beautifully designed, 
              professionally published books using the power of AI.
            </p>

            {/* Social Icons */}
            <div className="flex gap-5 mt-10">
              <a href="https://twitter.com" target="_blank" rel="noopener noreferrer" 
                 className="w-11 h-11 bg-white/5 hover:bg-white/10 rounded-2xl flex items-center justify-center transition-all hover:scale-110">
                <Twitter className="w-5 h-5" />
              </a>
              <a href="https://linkedin.com" target="_blank" rel="noopener noreferrer" 
                 className="w-11 h-11 bg-white/5 hover:bg-white/10 rounded-2xl flex items-center justify-center transition-all hover:scale-110">
                <Linkedin className="w-5 h-5" />
              </a>
            </div>
          </div>

          {/* Links Grid */}
          <div className="lg:col-span-7 grid grid-cols-2 md:grid-cols-3 gap-10">
            <div>
              <h3 className="text-white font-semibold mb-6 tracking-wider">PRODUCT</h3>
              <ul className="space-y-4">
                <li><a href="#features" className="hover:text-white transition-colors">Features</a></li>
                <li><a href="#pricing" className="hover:text-white transition-colors">Pricing</a></li>
                <li><a href="#templates" className="hover:text-white transition-colors">Templates</a></li>
              </ul>
            </div>

            <div>
              <h3 className="text-white font-semibold mb-6 tracking-wider">COMPANY</h3>
              <ul className="space-y-4">
                <li><a href="#about" className="hover:text-white transition-colors">About Us</a></li>
                <li><a href="#blog" className="hover:text-white transition-colors">Blog</a></li>
                <li><a href="#careers" className="hover:text-white transition-colors">Careers</a></li>
                <li><a href="#contact" className="hover:text-white transition-colors">Contact</a></li>
              </ul>
            </div>

            <div>
              <h3 className="text-white font-semibold mb-6 tracking-wider">LEGAL</h3>
              <ul className="space-y-4">
                <li><a href="#terms" className="hover:text-white transition-colors">Terms of Service</a></li>
                <li><a href="#privacy" className="hover:text-white transition-colors">Privacy Policy</a></li>
                <li><a href="#cookies" className="hover:text-white transition-colors">Cookie Policy</a></li>
              </ul>
            </div>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="border-t border-white/10 mt-16 pt-8 flex flex-col md:flex-row items-center justify-between gap-6 text-sm">
          <p>© {new Date().getFullYear()} AI Book Creator. All rights reserved.</p>
          
          <div className="flex items-center gap-2 text-gray-500">
            Made with <Heart className="w-4 h-4 text-red-500" /> for creators
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;