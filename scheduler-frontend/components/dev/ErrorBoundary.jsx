import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(p){super(p); this.state={err:null}}
  static getDerivedStateFromError(err){return {err}}
  componentDidCatch(err, info){console.error("App crashed:", err, info)}
  render(){
    if (this.state.err) {
      return (
        <pre style={{padding:16, color:"#b91c1c", background:"#fff0f0", whiteSpace:"pre-wrap"}}>
{String(this.state.err?.stack || this.state.err || "Unknown error")}
        </pre>
      );
    }
    return this.props.children;
  }
}
