export function buildChartData(gtData, predictions, options) {
    const { showSpaghetti, showBaselines } = options;
    const timeMap = new Map();
    
    // Add Ground truth data
    gtData.forEach(pt => { 
        timeMap.set(pt.time, { time: pt.time, fullTime: pt.fullTime, groundTruth: pt.groundTruth }); 
    });
    
    // Iterate and merge prediction data
    predictions.forEach(pred => {
      const pKey = `pred_${pred.id}`;
      
      pred.data.forEach(pt => {
        if (!timeMap.has(pt.time)) {
             timeMap.set(pt.time, { time: pt.time, fullTime: pt.fullTime, groundTruth: null });
        }
        const entry = timeMap.get(pt.time);
        
        entry[`${pKey}_central`] = pt.mean_close;
        
        if (pt.q10_close != null && pt.q90_close != null) {
            entry[`${pKey}_band80`] = [pt.q10_close, pt.q90_close];
        }
        if (pt.q25_close != null && pt.q75_close != null) {
            entry[`${pKey}_band50`] = [pt.q25_close, pt.q75_close];
        }
      });
      
      if (showBaselines && pred.baselines) {
          Object.entries(pred.baselines).forEach(([bName, bData]) => {
              if(!bData.prediction) return;
              bData.prediction.forEach(bp => {
                  const bTime = new Date(bp.timestamps).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  if (!timeMap.has(bTime)) return;
                  timeMap.get(bTime)[`${pKey}_baseline_${bName}`] = bp.close;
              });
          });
      }
      
      if (showSpaghetti && pred.paths) {
          pred.paths.forEach((pathVals, pathIdx) => {
              pred.data.slice(1).forEach((pt, j) => {
                  if(timeMap.has(pt.time)) {
                      timeMap.get(pt.time)[`${pKey}_path_${pathIdx}`] = pathVals[j];
                  }
              });
          });
      }
    });

    const entries = Array.from(timeMap.values());
    entries.sort((a, b) => new Date(a.fullTime) - new Date(b.fullTime));
    return entries;
}

export function parsePredictionAPIResponse(tickRes, reqConfig, colorFunc, predId) {
    const historical = tickRes.historical || [];
    const predPoints = tickRes.prediction || [];
    
    const anchor = historical.length > 0
        ? { time: new Date(historical[historical.length - 1].timestamps).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            fullTime: historical[historical.length - 1].timestamps, close: Number(historical[historical.length - 1].close) }
        : null;
        
    const predData = [];
    if (anchor) {
        predData.push({ 
            time: anchor.time, fullTime: anchor.fullTime, 
            mean_close: anchor.close, median_close: anchor.close,
            q10_close: anchor.close, q25_close: anchor.close, q75_close: anchor.close, q90_close: anchor.close
        });
    }
    
    predPoints.forEach(p => { 
        predData.push({ 
            time: new Date(p.timestamps).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), 
            fullTime: p.timestamps, 
            mean_close: Number(p.mean_close != null ? p.mean_close : p.close),
            median_close: Number(p.median_close != null ? p.median_close : p.close),
            q10_close: p.q10_close != null ? Number(p.q10_close) : null,
            q25_close: p.q25_close != null ? Number(p.q25_close) : null,
            q75_close: p.q75_close != null ? Number(p.q75_close) : null,
            q90_close: p.q90_close != null ? Number(p.q90_close) : null,
        }); 
    });
    
    return {
        id: predId, 
        model: reqConfig.model, 
        predLen: reqConfig.predLen,
        color: colorFunc,
        createdAt: new Date().toISOString(), 
        data: predData,
        paths: tickRes.paths || [],
        baselines: tickRes.baselines || {},
        regime: tickRes.regime || {},
        anchorClose: anchor ? anchor.close : 0,
        samples: reqConfig.sampleCount
    };
}
