import React from 'react';
import { useLocation, Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from '@/components/ui/button';
import { Plus, Calendar, Clock } from 'lucide-react';

const navItems = [
  { name: 'Calendar', path: createPageUrl('Calendar'), icon: Calendar },
  { name: 'DayPlanner', path: createPageUrl('DayPlanner'), icon: Clock },
];

export default function MainHeader({ title, onNewPost }) {
  const location = useLocation();

  return (
    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 p-6 border-b border-gray-100 bg-white/50 backdrop-blur-sm sticky top-0 z-10">
      <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent">
        {title}
      </h1>
      <div className="flex items-center gap-3">
        <div className="flex items-center p-1 bg-gray-100 rounded-lg">
          {navItems.map(item => {
            const isActive = location.pathname === item.path;
            return (
              <Button
                key={item.name}
                asChild
                variant={isActive ? 'default' : 'ghost'}
                size="sm"
                className={`w-full ${isActive ? 'bg-white shadow-sm' : ''}`}
              >
                <Link to={item.path} className="flex items-center gap-2">
                  <item.icon className="w-4 h-4" />
                  {item.name === 'DayPlanner' ? 'Day Plan' : item.name}
                </Link>
              </Button>
            );
          })}
        </div>
        <Button
          onClick={onNewPost}
          className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white"
        >
          <Plus className="w-4 h-4 mr-2" />
          New Post
        </Button>
      </div>
    </div>
  );
}