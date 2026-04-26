# Storefront Mobile App

React Native / Expo mobile storefront app connected to the Medusa backend.

## Prerequisites

- **Node.js** v22 (use `nvm use 22`)
- **Medusa backend** running at `http://localhost:9000`
- **Expo Go** app installed on your mobile device (for testing)

## Environment Variables

The app uses the following environment variables (configured in `.env`):

```
EXPO_PUBLIC_MEDUSA_URL=http://localhost:9000
EXPO_PUBLIC_MEDUSA_PUBLISHABLE_API_KEY=your_publishable_key
EXPO_PUBLIC_DEFAULT_REGION=us
EXPO_PUBLIC_STRIPE_KEY=your_stripe_key
```

**Note:** When testing on a physical device, replace `localhost` with your machine's local IP address (e.g., `http://192.168.1.100:9000`).

## Getting Started

1. **Install dependencies**

   ```bash
   yarn install
   ```

2. **Start the Medusa backend** (in the main project directory)

   ```bash
   yarn dev
   ```

3. **Start the Expo app**

   ```bash
   yarn start
   ```

4. **Run on device/emulator**
   - Scan the QR code with Expo Go (iOS/Android)
   - Press `a` for Android emulator
   - Press `i` for iOS simulator
   - Press `w` for web browser

## CORS Configuration

If testing on web (`localhost:8081`), add the Expo dev server URL to your Medusa backend's CORS settings:

```env
STORE_CORS=...,http://localhost:8081
AUTH_CORS=...,http://localhost:8081
```

## Features

- **Home Screen**: Browse products with hero banner
- **Product Details**: View product info, select variants, add to cart
- **Cart**: View/update cart items, proceed to checkout
- **Checkout**: Multi-step checkout (delivery, shipping, payment)
- **Region Selector**: Switch regions via drawer menu

## Project Structure

```
app/
├── _layout.tsx              # Root layout with providers
├── (drawer)/
│   ├── _layout.tsx          # Drawer navigator
│   └── (tabs)/
│       ├── _layout.tsx      # Tab navigator
│       ├── (home)/
│       │   ├── _layout.tsx  # Home stack
│       │   ├── index.tsx    # Home screen
│       │   └── product/
│       │       └── [id].tsx # Product detail
│       └── (cart)/
│           ├── _layout.tsx  # Cart stack
│           ├── index.tsx    # Cart screen
│           └── checkout/
│               └── index.tsx # Checkout screen
components/
├── product-card.tsx
├── cart-item.tsx
├── region-selector.tsx
└── drawer-content.tsx
context/
├── region-context.tsx
└── cart-context.tsx
lib/
├── medusa.ts               # Medusa SDK client
└── format-price.ts         # Price formatting utility
```

## Scripts

- `yarn start` - Start Expo development server
- `yarn android` - Run on Android
- `yarn ios` - Run on iOS
- `yarn web` - Run in web browser

## Learn More

- [Expo Documentation](https://docs.expo.dev/)
- [Medusa Storefront Guide](https://docs.medusajs.com/resources/storefront-development/guides/react-native-expo)
