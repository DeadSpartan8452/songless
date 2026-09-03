# Songless pour Android

Cette application transforme un téléphone Android en appareil hôte Songless. Elle
embarque le serveur local, ouvre l’administration complète et permet aux joueurs,
à la TV et à la télécommande administrateur de rejoindre la soirée par QR code.

## Construire l’APK transférable sous Windows

1. Ouvrir le dossier `packaging\android`.
2. Double-cliquer sur `Construire APK Songless.bat`.
3. Attendre le message « APK Songless prêt à être transféré ».
4. Récupérer `dist\Songless-Android\Songless-Android.apk`.

Au premier lancement, le constructeur crée une clé de signature privée dans le
dossier local de l’utilisateur Windows. Son mot de passe est chiffré avec Windows
DPAPI et n’entre jamais dans le dépôt. Cette clé doit être sauvegardée : Android
n’acceptera une future mise à jour de Songless que si elle porte la même signature.

Le fichier `Songless-Android.sha256.txt` permet de vérifier que l’APK transféré
n’a pas été altéré.

## Installation sur le téléphone

Transférer uniquement l’APK, l’ouvrir depuis le téléphone et autoriser
ponctuellement l’installation depuis l’application de fichiers. Cette autorisation
peut être retirée juste après l’installation.

Android 7 ou plus récent est requis. Le paquet contient les architectures ARM64
pour les téléphones et x86-64 pour l’émulateur de contrôle.

État de compatibilité : l’APK fonctionne sur l’émulateur Android 17 à pages de
16 Kio grâce au mode de compatibilité Android, mais plusieurs bibliothèques natives
restent alignées à 4 Kio. La compatibilité native 16 Kio sans avertissement reste
donc un chantier ouvert ; elle ne doit pas être annoncée comme livrée.

## Développement

# Getting Started

>**Note**: Make sure you have completed the [React Native - Environment Setup](https://reactnative.dev/docs/environment-setup) instructions till "Creating a new application" step, before proceeding.

## Step 1: Start the Metro Server

First, you will need to start **Metro**, the JavaScript _bundler_ that ships _with_ React Native.

To start Metro, run the following command from the _root_ of your React Native project:

```bash
# using npm
npm start

# OR using Yarn
yarn start
```

## Step 2: Start your Application

Let Metro Bundler run in its _own_ terminal. Open a _new_ terminal from the _root_ of your React Native project. Run the following command to start your _Android_ or _iOS_ app:

### For Android

```bash
# using npm
npm run android

# OR using Yarn
yarn android
```

### For iOS

```bash
# using npm
npm run ios

# OR using Yarn
yarn ios
```

If everything is set up _correctly_, you should see your new app running in your _Android Emulator_ or _iOS Simulator_ shortly provided you have set up your emulator/simulator correctly.

This is one way to run your app — you can also run it directly from within Android Studio and Xcode respectively.

## Step 3: Modifying your App

Now that you have successfully run the app, let's modify it.

1. Open `App.tsx` in your text editor of choice and edit some lines.
2. For **Android**: Press the <kbd>R</kbd> key twice or select **"Reload"** from the **Developer Menu** (<kbd>Ctrl</kbd> + <kbd>M</kbd> (on Window and Linux) or <kbd>Cmd ⌘</kbd> + <kbd>M</kbd> (on macOS)) to see your changes!

   For **iOS**: Hit <kbd>Cmd ⌘</kbd> + <kbd>R</kbd> in your iOS Simulator to reload the app and see your changes!

## Congratulations! :tada:

You've successfully run and modified your React Native App. :partying_face:

### Now what?

- If you want to add this new React Native code to an existing application, check out the [Integration guide](https://reactnative.dev/docs/integration-with-existing-apps).
- If you're curious to learn more about React Native, check out the [Introduction to React Native](https://reactnative.dev/docs/getting-started).

# Troubleshooting

If you can't get this to work, see the [Troubleshooting](https://reactnative.dev/docs/troubleshooting) page.

# Learn More

To learn more about React Native, take a look at the following resources:

- [React Native Website](https://reactnative.dev) - learn more about React Native.
- [Getting Started](https://reactnative.dev/docs/environment-setup) - an **overview** of React Native and how setup your environment.
- [Learn the Basics](https://reactnative.dev/docs/getting-started) - a **guided tour** of the React Native **basics**.
- [Blog](https://reactnative.dev/blog) - read the latest official React Native **Blog** posts.
- [`@facebook/react-native`](https://github.com/facebook/react-native) - the Open Source; GitHub **repository** for React Native.
