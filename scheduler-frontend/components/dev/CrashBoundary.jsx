import React from "react";

export default class CrashBoundary extends React.Component {
  constructor(p){ super(p); this.state = {err:null,info:null}; }
  static getDerivedStateFromError(err){ return { err }; }
  componentDidCatch(err, info){ console.error("[CrashBoundary]", err, info); this.setState({info}); }
  render(){
    if(this.state.err){
      return (
        <div style={{padding:16,fontFamily:'ui-sans-serif'}}>
          <h2 style={{color:'#b91c1c'}}>💥 App crashed</h2>
          <pre style={{whiteSpace:'pre-wrap', color:'#7f1d1d'}}>{String(this.state.err?.stack || this.state.err)}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}
