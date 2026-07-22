import React from "react";
import { Star } from "lucide-react";
import { TESTIMONIALS } from "../../utils/data";

const Testimonials = () => {
  return (
    <div id="testimonials" className="relative py-24 lg:py-32 bg-gradient-to-br from-gray-50 to-violet-50 overflow-hidden">
      
      {/* Background Decor */}
      <div className="absolute top-20 left-10 w-80 h-80 bg-violet-200/30 rounded-full blur-3xl"></div>
      <div className="absolute bottom-20 right-10 w-[28rem] h-[28rem] bg-purple-200/20 rounded-full blur-3xl"></div>

      <div className="max-w-7xl mx-auto px-6 lg:px-8 relative z-10">
        
        {/* Header */}
        <div className="text-center mb-16 max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-3 bg-white rounded-full px-6 py-3 shadow-sm border border-violet-100 mb-6">
            <Star className="w-6 h-6 text-violet-600" />
            <span className="uppercase font-semibold tracking-widest text-sm text-violet-700">Testimonials</span>
          </div>

          <h2 className="text-4xl lg:text-5xl font-bold text-gray-900 tracking-tighter">
            What Our Users Say About{" "}
            <span className="bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent">
              AI Book Creator
            </span>
          </h2>
        </div>

        {/* Testimonials Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {TESTIMONIALS.map((testimonial, index) => (
            <div
              key={index}
              className="group bg-white rounded-3xl p-8 shadow-md hover:shadow-2xl transition-all duration-500 hover:-translate-y-2 border border-gray-100 hover:border-violet-200 flex flex-col"
            >
              {/* Stars */}
              <div className="flex gap-1 mb-6">
                {[...Array(5)].map((_, i) => (
                  <Star 
                    key={i} 
                    className={`w-5 h-5 ${i < testimonial.rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-200'}`} 
                  />
                ))}
              </div>

              {/* Quote */}
              <p className="text-gray-700 text-[17px] leading-relaxed flex-1 mb-8">
                "{testimonial.quote}"
              </p>

              {/* Author */}
              <div className="flex items-center gap-4 mt-auto">
                <img
                  src={testimonial.avatar}
                  alt={testimonial.author}
                  className="w-12 h-12 rounded-2xl object-cover ring-2 ring-violet-100"
                />
                <div>
                  <p className="font-semibold text-gray-900">{testimonial.author}</p>
                  <p className="text-sm text-gray-500">{testimonial.title}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Bottom Trust Stats */}
        <div className="mt-20 flex flex-wrap justify-center gap-12 lg:gap-20 text-center">
          <div>
            <div className="text-5xl font-bold text-gray-900">50k+</div>
            <div className="text-gray-500 mt-2">Happy Creators</div>
          </div>
          <div>
            <div className="text-5xl font-bold text-gray-900">4.9/5</div>
            <div className="text-gray-500 mt-2">Average Rating</div>
          </div>
          <div>
            <div className="text-5xl font-bold text-gray-900">100k+</div>
            <div className="text-gray-500 mt-2">Books Created</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Testimonials;