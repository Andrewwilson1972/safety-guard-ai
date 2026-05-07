import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useEffect } from "react";
import NotFound from "@/pages/not-found";

import Dashboard from "@/pages/dashboard";
import VideoFeed from "@/pages/video-feed";
import Alerts from "@/pages/alerts";
import Reports from "@/pages/reports";
import HistoryPage from "@/pages/history";
import AssistantPage from "@/pages/assistant";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/video" component={VideoFeed} />
      <Route path="/alerts" component={Alerts} />
      <Route path="/history" component={HistoryPage} />
      <Route path="/assistant" component={AssistantPage} />
      <Route path="/reports" component={Reports} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
