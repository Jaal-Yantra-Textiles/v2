// routes.tsx
import { RouteObject } from "react-router-dom";
import PersonDetailPage from "../routes/persons/[id]/page";
import PersonMetdata from "../routes/persons/[id]/metadata/edit/page";

export const personRoutes: RouteObject[] = [
  {
    path: "persons/:id",
    element: <PersonDetailPage />,
    children: [
      {
        index: true, // This will be the index route showing person details
        element: <PersonDetailPage />,
      },
      {
        path: "metadata/edit",
        element: <PersonMetdata />,
      },
    ],
  },
];
