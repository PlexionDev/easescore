import type { Metadata, Viewport } from "next";
import AudienceDoors from "@/components/home/AudienceDoors";
import ClosingSearch from "@/components/home/ClosingSearch";
import DataSources from "@/components/home/DataSources";
import ExampleParcel from "@/components/home/ExampleParcel";
import FAQ from "@/components/home/FAQ";
import Hero from "@/components/home/Hero";
import Reveal from "@/components/home/Reveal";
import SiteFrame from "@/components/home/SiteFrame";

export const metadata: Metadata = {
  title: "EaseScore.AI — Intelligent Feasibility",
  description: "See what it takes to build on any lot in Allegheny County. Zoning, terrain, hazards and economics, with a source behind every number.",
};

export const viewport: Viewport = { themeColor: "#fbfcfd" };

export default function Home() {
  return (
    <SiteFrame home>
      <Hero />
      <AudienceDoors />
      <ExampleParcel />
      <DataSources />
      <FAQ />
      <ClosingSearch />
      <Reveal />
    </SiteFrame>
  );
}
