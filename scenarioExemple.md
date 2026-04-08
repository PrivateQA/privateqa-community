# Inscription et premier parcours utilisateur

- Ouvrir "https://privateqa.dev"
- Vérifie que "PrivateQA" est visible
- Clique sur "Get Started"
- Attends 1 s

## Inscription

- Remplis "First Name" avec "Alice"
- Remplis "Last Name" avec "Martin"
- Remplis "Email" avec "alice.martin@example.com"
- Remplis "Password" avec "S3cure!Pass"
- Remplis "Confirm Password" avec "S3cure!Pass"
- Sélectionne "France" dans "Country"
- Clique sur "Create Account"
- J'attends 2 s
- Vérifie que "Welcome, Alice" est visible

## Découverte du dashboard

- Vérifie que "My Projects" est visible
- Clique sur "New Project"
- Remplis "Project Name" avec "Demo E2E"
- Sélectionne "Web Application" dans "Project Type"
- Clique sur "Create"
- Vérifie que "Demo E2E" est visible

## Configuration du premier scénario

- Clique sur "Demo E2E"
- Clique sur "Add Scenario"
- Remplis "Scenario Name" avec "Login Flow"
- Remplis "Target URL" avec "https://staging.example.com"
- Clique sur "Save"
- Vérifie que "Login Flow" est visible

## Navigation et vérifications finales

- Scroll jusqu'à "Recent Runs"
- Vérifie que "No runs yet" est visible
- Scroll en haut de la page
- Clique sur "Settings"
- Vérifie que "alice.martin@example.com" est visible
- Clique sur "Documentation"
- Vérifie que "Syntax Reference" est visible
- Scroll jusqu'à "Plugin System" et clique sur "Learn More"
- J'attends 1 s
- Vérifie que "Enterprise" est visible

## Déconnexion

- Scroll en haut de la page
- Clique sur "Alice Martin"
- Clique sur "Logout"
- Vérifie que "Sign In" est visible
