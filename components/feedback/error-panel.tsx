import {
    Alert,
    AlertTitle,
    AlertDescription,
  } from "@/components/ui/alert";
  
  export function ErrorPanel({
    title,
    description,
  }: {
    title: string;
    description: string;
  }) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>{description}</AlertDescription>
      </Alert>
    );
  }