import React from 'react';

interface AppDetailsProps {
  app: {
    id: string;
    name: string;
    description: string;
    icon: string;
    category: string;
    screenshots: string[];
    rating: number;
    installs: number;
  };
}

const AppDetails: React.FC<AppDetailsProps> = ({ app }) => {
  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex flex-col md:flex-row gap-8">
        <div className="w-full md:w-1/3">
          <img src={app.icon} alt={app.name} className="w-full rounded-lg" />
        </div>
        <div className="w-full md:w-2/3">
          <h1 className="text-3xl font-bold mb-4">{app.name}</h1>
          <div className="flex items-center mb-4">
            <span className="text-yellow-400">★</span>
            <span className="ml-2">{app.rating}</span>
            <span className="ml-2 text-gray-600">({app.installs} installs)</span>
          </div>
          <p className="mb-6">{app.description}</p>
          <div className="flex gap-4">
            <button className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
              Install
            </button>
            <button className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300">
              Add to Favorites
            </button>
          </div>
        </div>
      </div>
      
      <div className="mt-8">
        <h2 className="text-xl font-semibold mb-4">Screenshots</h2>
        <div className="grid grid-cols-2 gap-4">
          {app.screenshots.map((screenshot, index) => (
            <img
              key={index}
              src={screenshot}
              alt={`${app.name} screenshot ${index + 1}`}
              className="rounded-lg"
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default AppDetails;
