import React, { useState } from 'react';

interface CategoryFilterProps {
  categories: string[];
  onCategorySelect: (category: string) => void;
}

const CategoryFilter: React.FC<CategoryFilterProps> = ({ categories, onCategorySelect }) => {
  const [selectedCategory, setSelectedCategory] = useState('');

  return (
    <div className="flex flex-wrap gap-2 p-4">
      <button
        onClick={() => {
          setSelectedCategory('');
          onCategorySelect('');
        }}
        className={`px-4 py-2 rounded-full ${
          selectedCategory === ''
            ? 'bg-blue-500 text-white'
            : 'bg-gray-200 text-gray-800'
        }`}
      >
        All
      </button>
      {categories.map((category) => (
        <button
          key={category}
          onClick={() => {
            setSelectedCategory(category);
            onCategorySelect(category);
          }}
          className={`px-4 py-2 rounded-full ${
            selectedCategory === category
              ? 'bg-blue-500 text-white'
              : 'bg-gray-200 text-gray-800'
          }`}
        >
          {category}
        </button>
      ))}
    </div>
  );
};

export default CategoryFilter;
