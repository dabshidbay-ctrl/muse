# <h1 align="center" > Real Estate with React Native </h1>

<div align="center">
    <img src="https://img.shields.io/badge/-Expo-black?style=for-the-badge&logoColor=white&logo=expo&color=000020" alt="expo" />
    <img src="https://img.shields.io/badge/-TypeScript-black?style=for-the-badge&logoColor=white&logo=typescript&color=3178C6" alt="typescript" />
    <img src="https://img.shields.io/badge/-Supabase-black?style=for-the-badge&logoColor=white&logo=supabase&color=3ECF8E" alt="supabase" />
    <img src="https://img.shields.io/badge/-Tailwind_CSS-black?style=for-the-badge&logoColor=white&logo=tailwindcss&color=06B6D4" alt="tailwindcss" />
  </div>

<div align="center">
  <p align="center">
    👨‍💻 This application is made with React Native 👨‍💻
    <br />
    <a href="https://github.com/alexworkdev/real_estate_app"><strong>Explore the docs »</strong></a>
    <br />
    <br />
    <a href="https://github.com/alexworkdev/real_estate_app/issues">Report Bug</a>
    ·
    <a href="https://github.com/alexworkdev/real_estate_app/issues">Request Feature</a>
  </p>
</div>

## 📋 <a name="table">Table of Contents</a>

1.  ℹ [Description](#description)
2. 🤖 [Introduction](#introduction)
3. ⚙️ [Tech Stack](#tech-stack)
4. 🏁 [Getting Started](#getting-started)
   1. 🔋 [Features](#features)
   2. 💡 [Prerequisites](#pre-requisites)
   3. ⚙️ [Installation](#installation)
5. 🧐 [Contributing](#contributing)
6. 🤩 [Resources](#resources)

## <a name="description">ℹ️ Description</a> 
I follow JavaScript Mastery Youtube Tutorial

<a href="https://youtu.be/CzJQEstIiEI" target="_blank"><img src="https://github.com/sujatagunale/EasyRead/assets/151519281/1736fca5-a031-4854-8c09-bc110e3bc16d" /></a>


## <a name="introduction">🤖  Introduction</a> 
Build a full-stack Real Estate application with React Native, featuring Google authentication, dynamic property listings, and user profiles. Designed with modern tools like Expo SDK 52, Supabase (auth + Postgres database), Tailwind CSS, and TypeScript for a seamless and scalable experience.

## <a name="tech-stack">⚙️  Tech Stack</a>

* <img align="left" src="https://img.shields.io/badge/expo-1C1E24?style=for-the-badge&logo=expo&logoColor=#D04A37" /> 
* <img align="left" src="https://img.shields.io/badge/react_native-%2320232a.svg?style=for-the-badge&logo=react&logoColor=%2361DAFB" /> 
* <img align="left" src="https://img.shields.io/badge/typescript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white" /> 
* <img align="left" src="https://img.shields.io/badge/typescript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white" /> 
* Nativewind
* <img align="left" src="https://img.shields.io/badge/Supabase-%233ECF8E.svg?style=for-the-badge&logo=supabase&logoColor=white" /> 
* <img align="left" src="https://img.shields.io/badge/tailwindcss-%2338B2AC.svg?style=for-the-badge&logo=tailwind-css&logoColor=white" /> 


## <a name="getting-started">🏁 Getting Started</a>
### <a name="features">🔋 Features</a>

👉 **Authentication**: Email + password sign-up/sign-in with confirmation and password reset, alongside Google OAuth — both handled by Supabase auth.

👉 **Home Page**: Displays the latest and recommended properties with powerful search and filter functionality.

👉 **Explore Page**: Allows users to browse all types of properties with a clean and intuitive interface.

👉 **Property Details Page**: Provides comprehensive information about individual properties, including images and key details.

👉 **Profile Page**: Editable name, account type, and settings that link to real screens

👉 **Bookings**: Guests request a stay; owners confirm or decline from the Requests tab; either side can cancel

👉 **Notifications**: Written by database triggers on booking events, private to the recipient, with an unread badge

👉 **Publish listings**: Property-owner and agency accounts can add properties, owned via `properties.owner_id` and enforced by RLS

👉 **Amenities & rental modes**: Owners add/delete amenities per property; listings are monthly rental or short-term (BnB-style)

👉 **Centralized Data Fetching**: Custom `useSupabase` hook inspired by TanStack’s useQuery for efficient queries.

👉 **Row Level Security**: Supabase RLS policies keyed on the Supabase user id, so users only ever read their own private rows.

and many more, including code architecture and reusability 


### <a name="pre-requisites">💡 Prerequisites</a>
  ```sh
  VS Code 
  Git
  Node.js
  node --version v20.10.0
  npm
  ```


### <a name="installation">⚙️ Installation</a>
1. To Get Started, Fork this repository to your GitHub account:
2. Clone the repo from your account using:
   ```sh
   git clone https://github.com/alexworkdev/real_estate_app.git
   ```
3. Open the project on Vs Code and go to the project directory 
   ```sh
   cd react_native_real_estate
   ```
4. Install dependencies
   ```sh
   npm install
   ```
5. Create a `.env` file in the project root (copy `.env.example`) and fill in your keys:

    ```env
    EXPO_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
    EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
    ```

6. **Set up Supabase** (auth + data)
   - Create a project at [supabase.com](https://supabase.com) and copy the project URL and *anon* key.
   - Go to *Authentication → Sign In / Providers*. **Email** is enabled by default —
     leave *Confirm email* on and the app will show a "check your inbox" screen after
     sign-up; turn it off and new accounts are signed in immediately.
   - On the same page enable **Google**, adding your Google OAuth Client ID / Secret
     from the Google Cloud console.
   - Under *Authentication → URL Configuration*, add `restate://` to **Redirect URLs**.
     Both the Google redirect and the email confirmation / password-reset links come
     back to that scheme. To run the web build too, add your web origin as well
     (`http://localhost:8081` for `npx expo start --web`, plus your deployed URL).
   - Google OAuth needs a custom URL scheme (`restate://`), so it requires a
     [development build](https://docs.expo.dev/develop/development-builds/introduction/) — it will not
     complete the redirect inside Expo Go. Email and password sign-in has no such
     constraint and works in Expo Go.
   - Run the migrations in order in the SQL editor:
     `supabase/migrations/0001_init.sql` (properties schema + RLS policies),
     `supabase/migrations/0002_search_and_indexes.sql` (parameterised `search_properties`
     RPC + trigram indexes),
     `supabase/migrations/0003_profiles_bookings_notifications.sql`
     (profiles/roles, bookings, notifications + their triggers and policies),
     `supabase/migrations/0004_roles_rental_modes_amenities.sql`
     (tenant/property-owner/agency/admin roles, rental modes, amenities),
     `supabase/migrations/0005_supabase_auth.sql`
     (auto-creates a `profiles` row on sign-up),
     `supabase/migrations/0006_role_default_and_policy_fixes.sql`
     (corrects the `profiles.role` default and tightens the booking/amenity policies),
     `supabase/migrations/0007_signup_role.sql` (account type chosen at sign-up),
     `supabase/migrations/0008_property_views.sql` (per-listing view counts),
     `supabase/migrations/0009_self_service_role.sql` (change your own account type),
     `supabase/migrations/0010_fix_profiles_policy_recursion.sql`
     (required: without it every profile update fails with a 42P17 recursion error),
     then `supabase/migrations/0011_role_enum.sql` (makes `role` a Postgres enum, so
     the Supabase table editor offers a dropdown instead of a free-text box).
     then `supabase/migrations/0012_categories_filters_photos.sql` (property categories
     become the `property_type` enum — villa / apartment / room / bnb — plus price and
     bedroom filters, the 18-photo cap, the `property-photos` storage bucket, and the
     booked-dates function the availability calendar reads).
     `supabase/migrations/0013_role_rule_via_trigger.sql` (moves the role rules
     off the RLS policy and onto a trigger, removing the last way `profiles` could
     raise a 42P17 recursion error), and
     `supabase/migrations/0014_property_views_self_select.sql` (lets a viewer read
     their own view rows, which the upsert that records a view needs in order to
     check its conflict target).
   - **Every migration is replay-safe**, so `supabase db push` can apply the whole
     folder repeatedly and running them by hand in the SQL editor first does no harm.
     `role` and `type` become enums along the way, so the earlier files cast to `::text`
     where they still mention the retired values — verified by applying all thirteen
     three times over against a real Postgres with data in the tables.
   - Optionally run `supabase/seed.sql` to load sample properties. It is safe to re-run.

7. **Error reporting with Sentry** (optional)

   Create a project at [sentry.io](https://sentry.io) (platform: *React Native*), then
   copy its DSN from *Project Settings → Client Keys (DSN)* into `.env`:

   ```env
   EXPO_PUBLIC_SENTRY_DSN=https://<key>@<org>.ingest.sentry.io/<project>
   ```

   Leave it unset and reporting is simply off — errors still print to the console.
   Reporting is disabled in development by default so an `expo start` session does not
   flood the project; set `EXPO_PUBLIC_SENTRY_DEBUG=true` to override that while
   debugging. Handled failures are tagged with the operation that raised them
   (`photo-upload`, `record-view`, `booking-create`, …) and with the Postgres error
   code, so an RLS refusal can be found by searching `pg_code:42501`.

   Note that Expo Go cannot load Sentry's native module: JavaScript errors are
   captured there, but native crashes need a development or release build.

   For readable stack traces in release builds, set `organization` and `project` in
   the `@sentry/react-native` entry in `app.json` (they are placeholders today), and
   export `SENTRY_AUTH_TOKEN` in the build environment so source maps upload. That
   token *is* a secret — keep it out of `.env` and out of the repo. Without it the
   app still reports errors; the traces are just minified.

8. **Become a publisher** (needed to publish listings)

   Listing rights are role-gated. Every user gets a `profiles` row automatically on
   first sign-in with `role = 'tenant'`; publishing requires `role = 'property_owner'`
   or `role = 'agency'` (and `role = 'admin'` can moderate/delete any listing). Roles are
   deliberately not self-assignable — the RLS update policy blocks a client from
   changing its own `role` — so promotion happens in the Supabase SQL editor:

   ```sql
   update public.profiles set role = 'property_owner' where email = 'you@example.com';
   ```

   The app shows your exact user id on **Profile → Profile** and on the "Add a listing"
   screen if you would rather match on `id`. Sign out and back in (or reopen the
   screen) to pick up the new role.

9. Start the app
   ```sh
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

See the [open issues](https://github.com/alexworkdev/real_estate_app/issues) for a full list of proposed features (and known issues).
 

## <a name="contributing">🧐 Contributing</a>

Pull requests are **accepted**. For major changes, please open a thread to discuss what you want to change first.

If you have a suggestion that would make this better, please fork the repo and create a pull request. You can also simply open an issue with the tag "enhancement".
Don't forget to give the project a star! Thanks again!

1. Fork the Project
2. Create your Feature Branch 
3. Commit your Changes 
4. Push to the Branch 
5. Open a Pull Request
  
## <a name="links">🔗 Links</a>

Assets and Constants used in the project can be found [here](https://drive.google.com/file/d/1HxuvAeJfiPfcZ1co5fU0ahKRw4sbA0gO/view?usp=sharing)

Database schema and RLS policies live in [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql); sample data is in [`supabase/seed.sql`](supabase/seed.sql).

Tutorial video that I follow: 

<a href="https://youtu.be/CzJQEstIiEI" target="_blank"><img src="https://github.com/sujatagunale/EasyRead/assets/151519281/1736fca5-a031-4854-8c09-bc110e3bc16d" /></a>

## <a name="resources">🤩 Resources</a>
Based on "Build Your First Mobile Application | React Native Real Estate App" video by [**JavaScript Mastery**](https://youtu.be/CzJQEstIiEI).
