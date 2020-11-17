package com.coaxial.tspweb.model;


import com.coaxial.tspweb.common.StatusCode;
import com.coaxial.tspweb.io.SessionWorker;
import com.coaxial.tspweb.io.reqRep.ClientRequest;
import com.google.maps.model.DistanceMatrixElement;
import com.google.maps.model.LatLng;
import com.google.maps.model.TravelMode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.*;
import java.util.concurrent.atomic.AtomicLong;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

/**
 * Chịu trách nhiệm về tất cả các quá trình giải quyết. Hoàn toàn .
 */
public class Solver
{
    private final Logger log = LoggerFactory.getLogger(Solver.class);


    //Gloabl, thread safe path counters.
    private volatile long allPaths;
    private volatile AtomicLong currentDonePaths;
    private volatile AtomicLong currentIncompletelyCalculatedPaths;
    private volatile AtomicLong currentCompletelyCalculatedPaths;
    private volatile AtomicLong globalBestConsumption;

    /**
     * Giải quyết vấn đề nhân viên bán hàng đi du lịch. Để biết chi tiết về cách hoạt động của thuật toán, vui lòng tham khảo
     * PDF-Documentation.
     *
     * @param request       yêu cầu của khách hàng
     * @param sessionWorker sessionWorker gọi phương thức này
     * @return a SolverResult đối tượng chứa các kết quả
     */
    public SolverResult exactSolve(ClientRequest request,
                                   SessionWorker sessionWorker)
    {
        LatLng[] places = request.getLocations().toArray(new LatLng[request.getLocations().size()]);
        //init / reset variables
        globalBestConsumption = new AtomicLong(Long.MAX_VALUE);
        currentDonePaths = new AtomicLong(0);
        currentIncompletelyCalculatedPaths = new AtomicLong(0);
        currentCompletelyCalculatedPaths = new AtomicLong(0);
        allPaths = faq(places.length - 1);

        //Requesting Google Distance Matrix API
        sessionWorker.tellStatus(StatusCode.CALCULATING, "Ma trận khoảng cách truy vấn từ ...");
        DistanceMatrixElement[][] distances = MapEngine.getDistances(places, TravelMode.DRIVING);
        if (distances == null)
        {
            sessionWorker.tellStatus(StatusCode.ERROR, "Truy vấn ma trận khoảng cách không thành công.");
            return null;
        }

        sessionWorker.tellStatus(StatusCode.CALCULATING, "Hỏi thông tin về độ cao từ ...");
        double[] elevations = MapEngine.getElevations(places);
        if (elevations == null)
        {
            sessionWorker.tellStatus(StatusCode.ERROR, "Yêu cầu thông tin độ cao không thành công.");
            return null;
        }

        sessionWorker.tellStatus(StatusCode.CALCULATING, "Tính toán thông tin tiêu thụ ...");
        double[][] consumptionMatrix = EnergyEngine.getEnergyConsumptionMatrix(distances, elevations, request.getEnergy());

        //Thread used to update the UI while calculating. This is not done in the calulating threads in order to prevent
        //overloading the AWT-Event-Thread
        Thread updater = new Thread(() ->
        {
            while (!Thread.interrupted())
            {
                sessionWorker.tellStatus(StatusCode.CALCULATING,
                        "Tính toán đường đi với các giá trị tiêu thụ tốt nhất ...",
                        Math.round(((currentDonePaths.get()) / (0.0 + allPaths)) * 100.0));
                try
                {
                    Thread.sleep(20);
                } catch (InterruptedException e)
                {
                    return;
                }
            }
        });
        updater.start();

        long time = System.nanoTime(); //start time measuring

        //Do distance matrix ordering in order to use the Nearest-Neighbor-Algorithm
        int[][] index = new int[distances.length][];
        for (int i = 0; i < distances.length; ++i)
        {
            ElementIndexComparator comp = new ElementIndexComparator(distances[i]);
            Integer[] indexLocal = comp.createIndexArray();
            Arrays.sort(indexLocal, comp);
            int[] toAdd = new int[indexLocal.length];
            for (int j = 0; j < toAdd.length; ++j)
                toAdd[j] = indexLocal[j];
            index[i] = toAdd;
        }

        //new list instance that can be copied by each thread
        ArrayList<Integer> startList = new ArrayList<>();
        startList.add(0);

        //Share work load on multiple threads
        int n = Runtime.getRuntime().availableProcessors() * 4;
        // int n = 1;
        int perProc = (int) (Math.min(1., distances.length / (n + 0.)));
        int alreadyUsedElements = 0;

        ArrayList<Thread> threads = new ArrayList<>();
        List<PathConsumption> results = Collections.synchronizedList(new ArrayList<>()); //save best result of each thread
        for (int i = 0; i < n && alreadyUsedElements < distances.length; ++i)
        {
            int myRangeEnd = alreadyUsedElements + (i == n - 1 ? distances.length - alreadyUsedElements : perProc);
            int myRangeStart = alreadyUsedElements;
            alreadyUsedElements = myRangeEnd;
            Thread currentThread = new Thread(() ->
            {
                PathConsumption myResult = recExact(new PathConsumption(0, 0, new ArrayList<>(startList)),
                        consumptionMatrix, distances, index, myRangeStart, myRangeEnd);
                results.add(myResult);
            });
            threads.add(currentThread);
            currentThread.start();
        }

        //Wait for all calculating threads to terminate
        for (Thread t : threads)
        {
            try
            {
                t.join();
            } catch (InterruptedException ignored)
            {
            }
        }
        //Stop time measuring
        time = (System.nanoTime() - time);
        updater.interrupt(); //Stop updating the UI

        //Find best path in all thread results
        PathConsumption result = results.get(0);
        for (int i = 1; i < results.size(); ++i)
            if (results.get(i).consumption < result.consumption) result = results.get(i);

        sessionWorker.tellStatus(StatusCode.DONE);

        final PathConsumption finalResult = result;
        List<Long> singleDistances = IntStream.range(1, result.path.size())
                .mapToObj(i -> distances[finalResult.path.get(i-1)][finalResult.path.get(i)].distance.inMeters)
                .collect(Collectors.toList());

        List<Double> singleConsumptions = IntStream.range(1, result.path.size())
                .mapToObj(i -> Math.round((consumptionMatrix[finalResult.path.get(i-1)][finalResult.path.get(i)] * 1D) / 100D) / 10D)
                .collect(Collectors.toList());

        return new SolverResult(result.path, elevations, singleDistances, singleConsumptions,result.distance, time,
                currentCompletelyCalculatedPaths.get(), currentIncompletelyCalculatedPaths.get(), allPaths,
                (globalBestConsumption.get() * 1D) / 1000D);
    }

    /**
     * Inner recursive method to solve the TSP. Called for each step while generating a path; also creates new branches
     * for every possible way,except this would directly result in a greater energy consumption than the global best
     * consumption amount for a path.
     * For more information on how this algorithm works, please refer to the PDF-Documentation.
     *
     * @param current   current path state
     * @param el        the energy consumption matrix of the electric vehicle
     * @param distances the distance matrix of all locations
     * @param index     the energy consumption index ordering matrix
     * @param begin     specifies the index where this method call should start iterating over the other places;
     *                  only used upon first call when it comes to word load splitting
     * @param end       specifies the index where this method call should end iterating over the other places;
     *                  only used upon first call when it comes to word load splitting
     * @return the path with the best consumption amount from this node including the current path
     */
    private PathConsumption recExact(PathConsumption current,
                                     double[][] el,
                                     DistanceMatrixElement[][] distances,
                                     int[][] index,
                                     int begin,
                                     int end)
    {
        int curPlace = current.path.get(current.path.size() - 1); //get current place
        if (current.path.size() == el.length) //if the current path has reached all places
        {
            current.path.add(0); //return to the starting place
            current.consumption += el[curPlace][0];
            current.distance += distances[curPlace][0].distance.inMeters;
            currentDonePaths.incrementAndGet();
            currentCompletelyCalculatedPaths.incrementAndGet();
            return current;
        } else if (current.consumption > globalBestConsumption.get()) //if the current consumption is exceeding the upper bound, stop iterating
        {
            long add = faq(el.length - current.path.size());
            currentIncompletelyCalculatedPaths.addAndGet((long) add);
            currentDonePaths.addAndGet((long) add);
            return current;
        } //else continue iterating

        PathConsumption localBest = new PathConsumption(Long.MAX_VALUE, 0, null);

        for (int k = (begin > -1 ? begin : 0); k < (end > -1 ? end : el[curPlace].length); ++k)
        {
            int nextPlaceIndex = index[curPlace][k];
            if (current.path.contains(nextPlaceIndex))
                continue;
            PathConsumption n = new PathConsumption(current.consumption, current.distance, new ArrayList<>(current.path));
            n.path.add(nextPlaceIndex);
            n.consumption += el[curPlace][nextPlaceIndex];
            n.distance += distances[curPlace][nextPlaceIndex].distance.inMeters;
            //determine whether the path from current place to next place (and the bust further recursion from there etc.) is better than current local and/or global one
            if ((n = recExact(n, el, distances, index, -1, -1)).consumption < localBest.consumption)
            {
                localBest = n;
                globalBestConsumption.getAndAccumulate(n.consumption, (old, newVal) -> old < newVal ? old : newVal);
            }
        }
        return localBest;
    }

    /**
     * Calculates the factorial of the specified int.
     *
     * @param of the int
     * @return the factorial of the int as int
     */
    private long faq(int of)
    {
        long r = 1;
        for (int i = 1; i <= of; ++i)
            r *= i;
        return r;
    }

    /**
     * Private Subclass to save a energy consumption amount, a distance and a path as a list in a single object.
     * Used in {@link Solver#recExact(PathConsumption, double[][], DistanceMatrixElement[][], int[][], int, int)} to pass data.
     */
    private class PathConsumption
    {
        long consumption;
        long distance;
        ArrayList<Integer> path;

        PathConsumption(long consumption, long distance, ArrayList<Integer> path)
        {
            this.consumption = consumption;
            this.path = path;
            this.distance = distance;
        }
    }
}

