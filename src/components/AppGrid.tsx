import React from 'react';

interface AppGridProps {
  apps: Array<{
    id: string;
    name: string;
    description: string;
    icon: string;
    category: string;
  }>;
}

const AppGrid: React.FC<AppGridProps> = ({ apps }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-4">
      {apps.map((app) => (
        <div key={app.id} className="bg-white rounded-lg shadow-md p-4">
          <div className="flex flex-col items-center">
            <img src={app.icon} alt={app.name} className="w-20 h-20 mb-4" />
            <h3 className="text-lg font-semibold">{app.name}</h3>
            <p className="text-gray-600 text-center">{app.description}</p>
            <button className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
              Install
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

export default AppGrid;
