/** @type {import('tailwindcss').Config} */
module.exports = {
    darkMode: ["class"],
    presets: [require("@medusajs/ui-preset")],
   content: [
    './src/admin/**/*.{js,jsx,ts,tsx}',
    // Add your components path
    './src/admin/components/**/*.{js,jsx,ts,tsx}',
    // If you have a specific UI folder
    './src/admin/components/ui/**/*.{js,jsx,ts,tsx}',
    './@/**/*.{ts,tsx}',
  ],
    theme: {
    	extend: {
    		colors: {
    			border: 'hsl(var(--border))',
    			input: 'hsl(var(--input))',
    			ring: 'hsl(var(--ring))',
    			background: 'hsl(var(--background))',
    			foreground: 'hsl(var(--foreground))',
    			primary: {
    				DEFAULT: 'hsl(var(--primary))',
    				foreground: 'hsl(var(--primary-foreground))'
    			},
    			secondary: {
    				DEFAULT: 'hsl(var(--secondary))',
    				foreground: 'hsl(var(--secondary-foreground))'
    			},
    			destructive: {
    				DEFAULT: 'hsl(var(--destructive))',
    				foreground: 'hsl(var(--destructive-foreground))'
    			},
    			muted: {
    				DEFAULT: 'hsl(var(--muted))',
    				foreground: 'hsl(var(--muted-foreground))'
    			},
    			accent: {
    				DEFAULT: 'hsl(var(--accent))',
    				foreground: 'hsl(var(--accent-foreground))'
    			},
    			popover: {
    				DEFAULT: 'hsl(var(--popover))',
    				foreground: 'hsl(var(--popover-foreground))'
    			},
    			card: {
    				DEFAULT: 'hsl(var(--card))',
    				foreground: 'hsl(var(--card-foreground))'
    			}
    		},
    		borderRadius: {
    			lg: '`var(--radius)`',
    			md: '`calc(var(--radius) - 2px)`',
    			sm: 'calc(var(--radius) - 4px)'
    		}, 
			animation: {
				"spinner-blade": "spinner-blade 1s linear infinite",
			  },
			  keyframes: {
				"spinner-blade": {
				  "0%": { opacity: "0.85" },
				  "50%": { opacity: "0.25" },
				  "100%": { opacity: "0.25" },
				},
			}
    	}
    },
    plugins: [require("tailwindcss-animate")],
  }
  